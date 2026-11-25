import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { hrWithPay } from '../middlewares/teamAccess.middleware.js';
import { BADGE_KIND, BADGE_URL_PREFIX, saveImage } from '../services/storedImage.service.js';

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.resolve(process.cwd(), 'uploads'));
/** Private upload root — NOT served by the static `/uploads` route. Used
 *  for files that should only flow through authenticated download
 *  endpoints (currently: candidate resumes).
 *
 *  Configurable via `PRIVATE_UPLOAD_ROOT` env var — set it to a path
 *  OUTSIDE your app deploy directory so files survive deploys. If your
 *  host swaps the app folder on each deploy (as most CI-driven hosts
 *  do), the default cwd-relative path will be wiped every time and
 *  previously-uploaded resumes will physically disappear from disk.
 *
 *  → Deploy-persistence probe: this comment intentionally exists as a
 *    trivial no-op change so pushing this commit forces a backend
 *    redeploy. The point is to verify whether files uploaded before
 *    the redeploy still exist on disk afterwards (with the env var
 *    pointing at a persistent path, they should). Safe to remove or
 *    tweak later.
 *
 *  → Production probe (2026-07-08): repeating the persistence test on
 *    the production environment now that the code + env-var are both
 *    in place. Uploaded a resume via /apply immediately before this
 *    push; after redeploy the file should still be at the configured
 *    PRIVATE_UPLOAD_ROOT path. */
export const PRIVATE_UPLOAD_ROOT = path.resolve(process.env.PRIVATE_UPLOAD_ROOT || path.resolve(process.cwd(), 'private-uploads'));
const BADGES_DIR = path.join(UPLOAD_ROOT, 'badges');
const BUG_REPORTS_DIR = path.join(UPLOAD_ROOT, 'bug-reports');

// Ensure folders exist at boot
fs.mkdirSync(PRIVATE_UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(BADGES_DIR, { recursive: true });
fs.mkdirSync(BUG_REPORTS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

// Badges are kept in the database (storedImage.service), not on disk — read into memory here.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Only PNG, JPG, WebP or SVG images are allowed'));
      return;
    }
    cb(null, true);
  },
});

// Device screenshots and short screen recordings — no SVG here, this is
// evidence, not an icon picker. Photos up to 5 MB, videos up to 50 MB, and at
// most 4 files per report so a bug report can't be used to dump unlimited disk usage.
const BUG_REPORT_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BUG_REPORT_VIDEO_EXT: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
const MAX_BUG_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BUG_VIDEO_BYTES = 50 * 1024 * 1024;
const bugReportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BUG_REPORTS_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? BUG_REPORT_VIDEO_EXT[file.mimetype] ?? '';
    cb(null, `${randomUUID()}${ext}`);
  },
});
const uploadBugReportPhotos = multer({
  storage: bugReportStorage,
  // Multer's limit is per file, whatever the kind — the video cap; photos are checked to 5 MB after.
  limits: { fileSize: MAX_BUG_VIDEO_BYTES, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (!BUG_REPORT_IMAGE_MIME.has(file.mimetype) && !(file.mimetype in BUG_REPORT_VIDEO_EXT)) {
      cb(new Error('Only photos (PNG, JPG, WebP) or videos (MP4, MOV, WebM) can be attached'));
      return;
    }
    cb(null, true);
  },
});

export { BADGES_DIR };
export const uploadRouter = Router();

uploadRouter.post(
  '/badge',
  authMiddleware,
  hrWithPay(), // position badge images — managed in Settings → Positions (HR with pay)
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });
    const id = await saveImage(BADGE_KIND, file.mimetype, file.buffer);
    res.json({ url: `${BADGE_URL_PREFIX}${id}${EXT_BY_MIME[file.mimetype] ?? ''}` });
  },
);

uploadRouter.post(
  '/bug-report-photos',
  authMiddleware,
  (req, res, next) => {
    uploadBugReportPhotos.array('photos', 4)(req, res, (err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  (req, res) => {
    const files = (req as any).files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return res.status(400).json({ message: 'No files uploaded' });
    const bigPhoto = files.find(f => BUG_REPORT_IMAGE_MIME.has(f.mimetype) && f.size > MAX_BUG_PHOTO_BYTES);
    if (bigPhoto) {
      for (const f of files) fs.rm(f.path, { force: true }, () => { /* best effort */ });
      return res.status(400).json({ message: `Each photo must be under ${MAX_BUG_PHOTO_BYTES / 1024 / 1024} MB` });
    }
    res.json({ urls: files.map(f => `/uploads/bug-reports/${f.filename}`) });
  },
);
