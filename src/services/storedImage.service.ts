import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { positions, storedImages } from '../db/schema.js';

// Position badges live in the database (StoredImage), so a deploy that starts
// from a fresh folder can't lose them. Their URL keeps the old shape —
// /uploads/badges/<id>.<ext> — so nothing that shows a badge had to change.

export const BADGE_KIND = 'badge';
export const BADGE_URL_PREFIX = '/uploads/badges/';

/** The id in a stored file name: "<uuid>.png" → "<uuid>". */
export const idFromFileName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');

/** Keep an image; returns its id. */
export async function saveImage(kind: string, mimeType: string, data: Buffer): Promise<string> {
  const id = randomUUID();
  await db.insert(storedImages).values({ id, kind, mimeType, data, createdAt: new Date() });
  return id;
}

export async function findImage(kind: string, id: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const [row] = await db.select({ kind: storedImages.kind, mimeType: storedImages.mimeType, data: storedImages.data }).from(storedImages).where(eq(storedImages.id, id));
  return row && row.kind === kind ? { mimeType: row.mimeType, data: Buffer.from(row.data) } : null;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/**
 * Badges uploaded before they lived in the database: copy each one a position
 * still uses from the badges folder into StoredImage (same id, so its URL
 * keeps working). Harmless to rerun. Returns how many were copied.
 */
export async function copyBadgeFilesIntoDb(badgesDir: string): Promise<number> {
  const rows = await db.select({ badgeUrl: positions.badgeUrl }).from(positions);
  let copied = 0;
  for (const { badgeUrl } of rows) {
    if (!badgeUrl?.startsWith(BADGE_URL_PREFIX)) continue;
    const file = path.basename(badgeUrl);
    const id = idFromFileName(file);
    const mimeType = MIME_BY_EXT[path.extname(file).toLowerCase()];
    const onDisk = path.join(badgesDir, file);
    if (!mimeType || !fs.existsSync(onDisk)) continue;
    const [already] = await db.select({ id: storedImages.id }).from(storedImages).where(eq(storedImages.id, id));
    if (already) continue;
    await db.insert(storedImages).values({ id, kind: BADGE_KIND, mimeType, data: fs.readFileSync(onDisk), createdAt: new Date() });
    copied++;
  }
  return copied;
}
