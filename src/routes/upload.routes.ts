import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middlewares/auth.middleware.js';

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.resolve(process.cwd(), 'uploads'));
/** Private upload root — NOT served by the static `/uploads` route. Used
 *  for files that should only flow through authenticated download
 *  endpoints (currently: candidate resumes).
 *
 *  Configurable via `PRIVATE_UPLOAD_ROOT` env var — set it to a path
 *  OUTSIDE your app deploy directory so files survive deploys. If your
 *  host swaps the app folder on each deploy (as most CI-driven hosts
 *  do), the default cwd-relative path will be wiped every time and
 *  previously-uploaded resumes will physically disappear from disk. */
export const PRIVATE_UPLOAD_ROOT = path.resolve(process.env.PRIVATE_UPLOAD_ROOT || path.resolve(process.cwd(), 'private-uploads'));
const BADGES_DIR = path.join(UPLOAD_ROOT, 'badges');

// Ensure folders exist at boot
fs.mkdirSync(PRIVATE_UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(BADGES_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BADGES_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase() ?? '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Only PNG, JPG, WebP or SVG images are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post(
  '/badge',
  authMiddleware,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  (req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({ url: `/uploads/badges/${file.filename}` });
  },
);
