import { Request, Response } from 'express';
import { z } from 'zod';
import {
  createRatingScale, deleteRatingScale, listRatingScales, setDefaultRatingScale, setRatingScaleActive, updateRatingScale, type RatingScaleInput,
} from '../services/appraisalRatingScales.service.js';
import { IN_USE_MESSAGE } from '../services/appraisalUsage.service.js';

// Settings → Rating scales (admins only — see the routes). Rules live in
// appraisalRatingScales.service.

const MIN_LEVELS = 2;
const MAX_LEVELS = 10;

const scaleSchema = z.object({
  name: z.string().trim().min(1, 'Give the scale a name').max(100),
  max: z.number().int().min(MIN_LEVELS).max(MAX_LEVELS),
  levels: z.array(z.object({
    value: z.number().int().min(1).max(MAX_LEVELS),
    label: z.string().trim().min(1, 'Every level needs a name').max(60),
    description: z.string().trim().max(300).optional(),
  })).max(MAX_LEVELS),
}).superRefine((s, ctx) => {
  // One entry per level, 1…max, in order.
  const values = s.levels.map(l => l.value);
  if (values.length !== s.max || values.some((v, i) => v !== i + 1)) {
    ctx.addIssue({ code: 'custom', message: 'Every level needs a name' });
  }
});

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });
const NOT_FOUND = { message: 'Rating scale not found' };

/** Blank descriptions are left out. */
const cleanInput = (s: z.infer<typeof scaleSchema>): RatingScaleInput => ({
  name: s.name!, max: s.max!,
  levels: s.levels!.map(l => ({ value: l.value!, label: l.label!, ...(l.description ? { description: l.description } : {}) })),
});

export async function listAppraisalRatingScales(_req: Request, res: Response): Promise<void> {
  res.json(await listRatingScales());
}

export async function createAppraisalRatingScale(req: Request, res: Response): Promise<void> {
  const parsed = scaleSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  res.status(201).json(await createRatingScale(cleanInput(parsed.data)));
}

export async function updateAppraisalRatingScale(req: Request, res: Response): Promise<void> {
  const parsed = scaleSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const scale = await updateRatingScale(req.params.id, cleanInput(parsed.data));
  if (!scale) { res.status(404).json(NOT_FOUND); return; }
  res.json(scale);
}

export async function setDefaultAppraisalRatingScale(req: Request, res: Response): Promise<void> {
  if (await setDefaultRatingScale(req.params.id) === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  res.json(await listRatingScales());
}

const activeSchema = z.object({ active: z.boolean() });

/** Make a scale active (offered when picking) or inactive. */
export async function setAppraisalRatingScaleActive(req: Request, res: Response): Promise<void> {
  const parsed = activeSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const result = await setRatingScaleActive(req.params.id, parsed.data.active!);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'is-default') { res.status(409).json({ message: 'This is the default scale — make another one the default first.' }); return; }
  res.json(result);
}

export async function deleteAppraisalRatingScale(req: Request, res: Response): Promise<void> {
  const result = await deleteRatingScale(req.params.id);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'is-default') { res.status(409).json({ message: 'This is the default scale — make another one the default first.' }); return; }
  if (result === 'in-use') { res.status(409).json({ message: IN_USE_MESSAGE }); return; }
  res.status(204).end();
}
