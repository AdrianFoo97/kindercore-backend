import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { PRIVATE_UPLOAD_ROOT } from '../routes/upload.routes.js';

// Shared plumbing for photos / videos kept in the PRIVATE upload root (never
// the public /uploads mount) and served only through authenticated
// endpoints — facility issue attachments, purchase receipts.

export const MB = 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
};

export type AttachmentKind = 'image' | 'video';

export interface StoredAttachment {
  /** Stored file name (uuid + extension) — also its id in the download URL. */
  id: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** The name it had on the sender's phone, for display only. */
  name: string;
}

/** 'image' / 'video' for a type we accept, otherwise null. */
export function attachmentKind(mime: string): AttachmentKind | null {
  if (!(mime in EXT_BY_MIME)) return null;
  return mime.startsWith('video/') ? 'video' : 'image';
}

/** Deletes uploaded files that won't be kept (the request was refused). */
export function discardUploads(files: { path: string }[]): void {
  for (const f of files) fs.rm(f.path, { force: true }, () => { /* best effort */ });
}

export function toAttachment(f: Express.Multer.File): StoredAttachment {
  return {
    id: f.filename,
    kind: attachmentKind(f.mimetype) ?? 'image',
    mime: f.mimetype,
    size: f.size,
    name: f.originalname.slice(0, 120),
  };
}

/** A private folder under the upload root, created if missing. */
export function privateFolder(name: string): string {
  const dir = path.join(PRIVATE_UPLOAD_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface UploadOptions {
  dir: string;
  field: string;
  maxFiles: number;
  /** Multer's hard cap per file; finer per-kind checks belong in the handler. */
  maxBytes: number;
  kinds: AttachmentKind[];
  /** Shown when a file's type isn't allowed. */
  typeMessage: string;
  tooBigMessage: string;
  tooManyMessage: string;
}

/** Express middleware accepting multipart with up to `maxFiles` files under `field`, saved into `dir`. */
export function privateUpload(o: UploadOptions) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, o.dir),
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] ?? ''}`),
    }),
    limits: { fileSize: o.maxBytes, files: o.maxFiles },
    fileFilter: (_req, file, cb) => {
      const kind = attachmentKind(file.mimetype);
      if (!kind || !o.kinds.includes(kind)) { cb(new Error(o.typeMessage)); return; }
      cb(null, true);
    },
  });
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.array(o.field, o.maxFiles)(req, res, err => {
      if (!err) { next(); return; }
      const code = err instanceof multer.MulterError ? err.code : null;
      res.status(400).json({
        message: code === 'LIMIT_FILE_SIZE' ? o.tooBigMessage
          : code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE' ? o.tooManyMessage
          : err instanceof Error ? err.message : 'Upload failed',
      });
    });
  };
}
