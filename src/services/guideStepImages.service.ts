import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { storedImages } from '../db/schema.js';
import { MB } from './privateUploads.service.js';

// How-To Guide step photos. Kept in the database (StoredImage) like position
// badges, so a redeploy can't lose them, and served only to signed-in staff.
// A photo is never changed in place: picking a new one stores a new image,
// so an older version or a pending proposal keeps the picture it had.

export const GUIDE_STEP_IMAGE_KIND = 'guide-step';
/** The app shrinks photos (to ~1600 px) before sending, so this is generous. */
export const MAX_GUIDE_STEP_IMAGE_BYTES = 5 * MB;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GUIDE_STEP_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) { cb(new Error('Only photos (JPG, PNG or WebP) can be added to a step')); return; }
    cb(null, true);
  },
});

/** One photo under "image", read into memory (it goes into the database). */
export function guideStepImageUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, err => {
    if (!err) { next(); return; }
    const code = err instanceof multer.MulterError ? err.code : null;
    res.status(400).json({
      message: code === 'LIMIT_FILE_SIZE' ? `The photo must be under ${MAX_GUIDE_STEP_IMAGE_BYTES / MB} MB`
        : code ? 'Add one photo at a time'
        : err instanceof Error ? err.message : 'Upload failed',
    });
  });
}

/** The ids among these that aren't stored step photos (so a step can't point at a badge or nothing). */
export async function unknownGuideImageIds(ids: (string | null | undefined)[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return [];
  const found = await db.select({ id: storedImages.id }).from(storedImages)
    .where(and(inArray(storedImages.id, wanted), eq(storedImages.kind, GUIDE_STEP_IMAGE_KIND)));
  const known = new Set(found.map(r => r.id));
  return wanted.filter(id => !known.has(id));
}

export const UNKNOWN_IMAGE_MESSAGE = 'A step photo wasn’t found — add it again.';
