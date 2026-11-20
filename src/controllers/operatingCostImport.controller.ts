import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { PNL_READING_FEATURE, StatementReadError } from '../services/pnlReading/index.js';
import { aiFeatureStatus } from '../services/ai/run.js';
import { ImportProblem, applyImport, dismissNotice, importHistory, openNotices, previewImport, recordNotImportedLine, type ApplyInput, type RecordLineInput } from '../services/pnlImport.service.js';
import { isAdminRole } from '../middlewares/auth.middleware.js';

// Finance → Operating Costs → Import P&L. Read (preview, saves nothing),
// apply, and the "not imported" notices on each month.

/** Error code telling the import page the AI failed — it then offers to read without AI. */
export const AI_FAILED = 'AI_FAILED';

/** A P&L is a few pages; anything bigger is almost certainly the wrong file. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(), // read and forgotten — the PDF is never saved
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') { cb(new Error('Choose a PDF file.')); return; }
    cb(null, true);
  },
});

/** Accepts one PDF under `file`, with a clear message for the wrong type or size. */
export function pdfUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, err => {
    if (!err) { next(); return; }
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({ message: tooBig ? 'That file is over 10 MB. Is it the P&L?' : err instanceof Error ? err.message : 'Upload failed' });
  });
}

/** Whether importing is set up on this server (no reader = no Import button). */
export async function getImportStatus(_req: Request, res: Response): Promise<void> {
  res.json(await aiFeatureStatus(PNL_READING_FEATURE));
}

export async function readImport(req: Request, res: Response): Promise<void> {
  if (!req.file) { res.status(400).json({ message: 'Choose a PDF file.' }); return; }
  // Sent as a form field with the file: read the PDF's text instead of asking the AI.
  const withoutAi = req.body?.withoutAi === '1';
  try {
    res.json({ fileName: req.file.originalname, ...(await previewImport(req.file.buffer, req.user!.id, { withoutAi })) });
  } catch (e) {
    // The AI couldn't read it: say so, so the person can choose to carry on without AI.
    if (e instanceof StatementReadError) { res.status(422).json({ message: e.message, code: AI_FAILED }); return; }
    if (e instanceof ImportProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}

const decisionSchema = z.object({
  name: z.string().trim().min(1).max(191),
  section: z.string().trim().min(1).max(191),
  amount: z.number().finite().min(0),
  action: z.enum(['RECORD', 'SKIP']),
  categoryId: z.string().max(64).nullable(),
  byRule: z.boolean().optional(),
  replace: z.boolean().optional(),
  remember: z.boolean().optional(),
});

const applySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  fileName: z.string().trim().min(1).max(191),
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  instructionsVersion: z.number().int().min(0), // 0 = read without AI
  lines: z.array(decisionSchema).min(1).max(500),
  newCategories: z.array(z.object({
    tempId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(191),
    groupId: z.string().min(1).max(36),
  })).max(100).default([]),
});

export async function applyImportHandler(req: Request, res: Response): Promise<void> {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Some import details are missing or invalid.', errors: parsed.error.errors }); return; }
  try {
    const result = await applyImport(parsed.data as ApplyInput, { id: req.user!.id, email: req.user!.email, isAdmin: isAdminRole(req.user!.role) });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof ImportProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}

const noticeQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(0).max(11),
});

/** A month's imports with lines that weren't recorded (month 0-11, as entries). */
export async function listImportNotices(req: Request, res: Response): Promise<void> {
  const parsed = noticeQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ message: 'Give a year and month.' }); return; }
  res.json(await openNotices(parsed.data.year, parsed.data.month));
}

export async function dismissImportNotice(req: Request, res: Response): Promise<void> {
  if (!(await dismissNotice(req.params.id))) { res.status(404).json({ message: 'Import not found' }); return; }
  res.status(204).end();
}

/** Operating Costs → Import history: every P&L import, newest first. */
export async function getImportHistory(_req: Request, res: Response): Promise<void> {
  res.json(await importHistory());
}

const recordLineSchema = z.object({
  index: z.number().int().min(0).max(1000),
  name: z.string().min(1).max(191),
  categoryId: z.string().min(1).max(36),
  existing: z.enum(['replace', 'add']).optional(),
  remember: z.boolean().optional(),
});

/** Records one line an import left out (from the month's "not recorded" pop-up). */
export async function recordNoticeLine(req: Request, res: Response): Promise<void> {
  const parsed = recordLineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Choose a category to record this line in.' }); return; }
  try {
    const result = await recordNotImportedLine(req.params.id, parsed.data as RecordLineInput);
    // The category already has an amount that month: the page asks whether to replace it or add to it.
    if ('existingAmount' in result) { res.status(409).json({ message: 'That category already has an amount this month.', code: 'HAS_AMOUNT', existingAmount: result.existingAmount }); return; }
    res.json(result);
  } catch (e) {
    if (e instanceof ImportProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}
