import type { Request, Response } from 'express';
import { profilePhoto, removeProfilePhoto, setProfilePhoto } from '../services/profilePhoto.service.js';

// My Profile → photo. Always the caller's own — there's no user id in these addresses.

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
