import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db, pool } from '../../db/client.js';
import { positions, storedImages, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';
import { BADGES_DIR } from '../../routes/upload.routes.js';
import { copyBadgeFilesIntoDb } from '../../services/storedImage.service.js';

// Position badges are kept in the database: the host builds every deploy into
// a fresh folder, so a badge saved as a file disappeared on the next deploy
// (still showing where the browser had cached it, missing everywhere else).

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = new Date('2026-01-01T00:00:00Z');

let server: LiveServer;
let admin: Caller;

beforeAll(async () => {
  await resetTables(storedImages, positions, users);
  await db.insert(users).values(await activeUser({ id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' }));
  server = await startLiveServer();
  admin = await signIn(server.base, 'admin@kindertech.test', PASSWORD);
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const fetchImage = (url: string) => fetch(`${server.base}${url}`);

describe('Position badges — they survive a deploy', () => {
  it('keeps an uploaded badge in the database, so it loads without any file on disk', async () => {
    const form = new FormData();
    form.append('image', new Blob([PNG], { type: 'image/png' }), 'badge.png');
    const res = await fetch(`${server.base}/api/upload/badge`, { method: 'POST', body: form, headers: { Cookie: admin.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE } });
    expect(res.status).toBe(200);
    const { url } = await res.json() as { url: string };
    expect(url).toMatch(/^\/uploads\/badges\/[0-9a-f-]{36}\.png$/);
    expect(fs.existsSync(path.join(BADGES_DIR, path.basename(url)))).toBe(false);
    const image = await fetchImage(url);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('copies a badge that was only on disk into the database, keeping its address', async () => {
    const file = '11111111-2222-3333-4444-555555555555.png';
    const onDisk = path.join(BADGES_DIR, file);
    fs.writeFileSync(onDisk, PNG);
    try {
      await db.insert(positions).values({ positionId: 'P-OLD', name: 'Old badge', badgeUrl: `/uploads/badges/${file}`, createdAt: NOW, updatedAt: NOW } as typeof positions.$inferInsert);
      expect(await copyBadgeFilesIntoDb(BADGES_DIR)).toBe(1);
      expect(await copyBadgeFilesIntoDb(BADGES_DIR)).toBe(0); // only once
    } finally {
      fs.rmSync(onDisk, { force: true }); // …as a deploy would
    }
    expect((await fetchImage(`/uploads/badges/${file}`)).status).toBe(200);
  });
});
