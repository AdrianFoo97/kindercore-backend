import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { storedImages, users } from '../db/schema.js';
import { findImage, saveImage } from './storedImage.service.js';
import { MB } from './privateUploads.service.js';

// A person's own profile photo (My Profile). Kept in the database
// (StoredImage, kind 'profile') like badges, so a redeploy can't lose it.
// Each person sets or removes only their own; the app shrinks it first.

export const PROFILE_PHOTO_KIND = 'profile';
export const MAX_PROFILE_PHOTO_BYTES = 5 * MB;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) { cb(new Error('Choose a photo (JPG, PNG or WebP)')); return; }
    cb(null, true);
  },
});

/** One photo under "photo", read into memory (it goes into the database). */
export function profilePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('photo')(req, res, err => {
    if (!err) { next(); return; }
    const code = err instanceof multer.MulterError ? err.code : null;
    res.status(400).json({
      message: code === 'LIMIT_FILE_SIZE' ? `The photo must be under ${MAX_PROFILE_PHOTO_BYTES / MB} MB`
        : code ? 'Choose one photo'
        : err instanceof Error ? err.message : 'Upload failed',
    });
  });
}

async function currentPhotoId(userId: string): Promise<string | null> {
  const [row] = await db.select({ photoImageId: users.photoImageId }).from(users).where(eq(users.id, userId));
  return row?.photoImageId ?? null;
}

const dropImage = (id: string | null) => (id ? db.delete(storedImages).where(and(eq(storedImages.id, id), eq(storedImages.kind, PROFILE_PHOTO_KIND))) : null);

/** Set this person's photo (the old one is removed). */
export async function setProfilePhoto(userId: string, mimeType: string, data: Buffer): Promise<void> {
  const before = await currentPhotoId(userId);
  const id = await saveImage(PROFILE_PHOTO_KIND, mimeType, data);
  await db.update(users).set({ photoImageId: id }).where(eq(users.id, userId));
  await dropImage(before);
}

export async function removeProfilePhoto(userId: string): Promise<void> {
  const before = await currentPhotoId(userId);
  if (!before) return;
  await db.update(users).set({ photoImageId: null }).where(eq(users.id, userId));
  await dropImage(before);
}

export async function profilePhoto(userId: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const id = await currentPhotoId(userId);
  return id ? findImage(PROFILE_PHOTO_KIND, id) : null;
}
