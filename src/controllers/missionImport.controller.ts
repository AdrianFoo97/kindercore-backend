import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { largeJsonBody } from '../middlewares/bodyLimit.middleware.js';
import { MissionImportProblem, MissionReadError, applyMissionImport, missionTemplateFile, readMissionFile } from '../services/missionImport/index.js';
import { upsertCategorySchema } from './mission-categories.controller.js';
import { upsertMissionSchema } from './career-missions.controller.js';

// Settings → Career missions / Mission categories → Import with AI. Read
// (preview — saves nothing) and apply (creates only what the person kept,
// with the same checks as adding them one by one).

/** The page's code when the AI couldn't read the file. */
export const AI_FAILED = 'AI_FAILED';

/** A mission list is a few pages; 7 MB keeps its base64 under LARGE_JSON_LIMIT. */
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const TOO_BIG = 'That file is over 7 MB.';

const fileJsonSchema = z.object({ fileName: z.string().max(255).optional(), fileBase64: z.string().min(1) });

/**
 * The file arrives as base64 JSON (Hostinger's firewall blocks file uploads —
 * see the P&L import). Parsed with the large allowance only here, after
 * sign-in and the access check.
 */
export function missionFileUpload(req: Request, res: Response, next: NextFunction): void {
  largeJsonBody(req, res, err => {
    if (err) { res.status(400).json({ message: (err as { type?: string }).type === 'entity.too.large' ? TOO_BIG : 'Upload failed' }); return; }
    const parsed = fileJsonSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: 'Choose an Excel (.xlsx) or PDF file.' }); return; }
    const buffer = Buffer.from(parsed.data.fileBase64, 'base64');
    if (buffer.length > MAX_FILE_BYTES) { res.status(400).json({ message: TOO_BIG }); return; }
    req.file = { buffer, originalname: parsed.data.fileName || 'missions', size: buffer.length } as Express.Multer.File;
    next();
  });
}

export async function readMissionImport(req: Request, res: Response): Promise<void> {
  try {
    res.json({ fileName: req.file!.originalname, ...(await readMissionFile(req.file!.buffer, req.user!.id)) });
  } catch (e) {
    if (e instanceof MissionReadError) { res.status(422).json({ message: e.message, code: AI_FAILED }); return; }
    if (e instanceof MissionImportProblem) { res.status(e.status).json({ message: e.message, problems: e.problems }); return; }
    throw e;
  }
}

/** The no-AI template (base64 in JSON — the page saves it as a file). */
export async function getMissionTemplate(_req: Request, res: Response): Promise<void> {
  const { fileName, file } = await missionTemplateFile();
  res.json({ fileName, fileBase64: file.toString('base64') });
}

const applySchema = z.object({
  categories: z.array(upsertCategorySchema.omit({ sortOrder: true }).extend({ description: z.string().nullable() })),
  missions: z.array(upsertMissionSchema.omit({ displayOrder: true, requiresApproval: true }).extend({
    description: z.string().nullable(), whyItMatters: z.string().nullable(), evidenceRequirements: z.string().nullable(),
  })),
}).refine(b => b.categories.length + b.missions.length > 0, 'Choose at least one mission or category to create.');

export async function applyMissionImportHandler(req: Request, res: Response): Promise<void> {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Validation error', errors: parsed.error.errors }); return; }
  try {
    res.json(await applyMissionImport(parsed.data as Parameters<typeof applyMissionImport>[0]));
  } catch (e) {
    if (e instanceof MissionImportProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}
