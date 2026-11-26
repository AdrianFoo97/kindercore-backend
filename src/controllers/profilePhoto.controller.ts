import type { Request, Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { profilePhoto, removeProfilePhoto, setProfilePhoto } from '../services/profilePhoto.service.js';

// My Profile → photo and display name. Always the caller's own — there's no user id in these addresses.

export async function getMyPhoto(req: Request, res: Response): Promise<void> {
  const photo = await profilePhoto(req.user!.id);
  if (!photo) { res.status(404).json({ message: 'No photo' }); return; }
  res.setHeader('Content-Type', photo.mimeType);
  // The photo can change at the same address — the browser checks again each time.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(photo.data);
}

export async function putMyPhoto(req: Request, res: Response): Promise<void> {
  if (!req.file) { res.status(400).json({ message: 'Choose a photo' }); return; }
  await setProfilePhoto(req.user!.id, req.file.mimetype, req.file.buffer);
  res.json({ ok: true });
}

export async function deleteMyPhoto(req: Request, res: Response): Promise<void> {
  await removeProfilePhoto(req.user!.id);
  res.json({ ok: true });
}

/** Longest display name — fits the account button and Home without cutting off. */
export const MAX_DISPLAY_NAME = 60;
const displayNameSchema = z.object({ displayName: z.string().max(MAX_DISPLAY_NAME, `Keep it to ${MAX_DISPLAY_NAME} characters.`).nullable() });

/** The name the app shows you by. Blank (or the same as your full name) goes back to your full name. */
export async function putMyDisplayName(req: Request, res: Response): Promise<void> {
  const parsed = displayNameSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Validation error' }); return; }
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id));
  const typed = (parsed.data.displayName ?? '').replace(/\s+/g, ' ').trim();
  const displayName = typed && typed !== me?.name ? typed : null;
  await db.update(users).set({ displayName }).where(eq(users.id, req.user!.id));
  res.json({ displayName });
}
