import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  createCandidate,
  getCandidates,
  getCandidateStats,
  getCandidateById,
  updateCandidate,
  hireCandidate,
  deleteCandidate,
  getCandidateFormOptions,
  getUpcomingCandidateInterviews,
  scheduleCandidateInterview,
  unscheduleCandidateInterview,
  uploadCandidateResume,
  downloadCandidateResume,
  seedDummyCandidates,
  importCandidates,
  resetAllCandidates,
  getCandidatePhoneIndex,
} from '../controllers/candidates.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { PRIVATE_UPLOAD_ROOT } from './upload.routes.js';

// Resume uploads land in a per-candidate folder; multer writes a temp file
// here first and the controller validates magic bytes before renaming it
// into place. Keep this dir distinct from the static `/uploads` mount.
const TMP_RESUME_DIR = path.join(PRIVATE_UPLOAD_ROOT, 'resumes', '_tmp');
fs.mkdirSync(TMP_RESUME_DIR, { recursive: true });

const ALLOWED_RESUME_MIME = new Set(['application/pdf']);
const ALLOWED_RESUME_EXT = new Set(['.pdf']);

const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_RESUME_DIR),
    // Random temp name; controller will rename after magic-byte check.
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.tmp`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Reject early on MIME and extension before any bytes hit disk; the
    // controller does the deeper magic-byte check after.
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_RESUME_MIME.has(file.mimetype) || !ALLOWED_RESUME_EXT.has(ext)) {
      cb(new Error('Only PDF resumes are allowed.'));
      return;
    }
    cb(null, true);
  },
});

export const candidatesRouter = Router();

// Public — anyone with the apply link can submit / fetch dropdown options
candidatesRouter.post('/', asyncHandler(createCandidate));
candidatesRouter.get('/form-options', asyncHandler(getCandidateFormOptions));
// Public resume upload — bound to a freshly-created candidate id, scoped by
// the controller to a short window + one-shot. Multer errors are surfaced
// as 400s instead of bubbling out of the stack.
candidatesRouter.post('/:id/resume', (req, res, next) => {
  resumeUpload.single('resume')(req, res, (err) => {
    if (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ message: msg });
    }
    next();
  });
}, asyncHandler(uploadCandidateResume));

// Admin
candidatesRouter.get('/', authMiddleware, asyncHandler(getCandidates));
candidatesRouter.get('/stats', authMiddleware, asyncHandler(getCandidateStats));
candidatesRouter.get('/upcoming-interviews', authMiddleware, asyncHandler(getUpcomingCandidateInterviews));
// Cross-tab phone list — feeds the repeat-applicant pill in the admin list.
// Kept above /:id so Express doesn't route "phone-index" to getCandidateById.
candidatesRouter.get('/phone-index', authMiddleware, asyncHandler(getCandidatePhoneIndex));
candidatesRouter.get('/:id', authMiddleware, asyncHandler(getCandidateById));
candidatesRouter.patch('/:id', authMiddleware, asyncHandler(updateCandidate));
// Confirms hire details and creates the Teacher record in one step —
// separate from the generic PATCH because it also writes to Teacher/CareerRecord.
candidatesRouter.post('/:id/hire', authMiddleware, asyncHandler(hireCandidate));
candidatesRouter.delete('/:id', authMiddleware, asyncHandler(deleteCandidate));
candidatesRouter.get('/:id/resume', authMiddleware, asyncHandler(downloadCandidateResume));
// Interview scheduling with Google Calendar sync. The frontend calls
// /schedule-interview by default; if the calendar step fails, it retries
// with skipCalendar: true which persists to the DB only.
candidatesRouter.post('/:id/schedule-interview',   authMiddleware, asyncHandler(scheduleCandidateInterview));
candidatesRouter.post('/:id/unschedule-interview', authMiddleware, asyncHandler(unscheduleCandidateInterview));

// Admin bulk import — admin only. Batches of up to 500 rows per POST.
candidatesRouter.post('/import', authMiddleware, adminMiddleware, asyncHandler(importCandidates));

// Admin nuclear reset — deletes every candidate row + resume file.
// Meant for import iteration on a fresh env, not for regular use.
candidatesRouter.post('/reset-all', authMiddleware, adminMiddleware, asyncHandler(resetAllCandidates));

// Dev / demo — admin only.
candidatesRouter.post('/seed-dummy', authMiddleware, adminMiddleware, asyncHandler(seedDummyCandidates));
