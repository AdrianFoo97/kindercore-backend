import { Request, Response } from 'express';
import { z } from 'zod';
import { scoringFormSectionsSchema } from './appraisalScoringSchemas.js';
import { unknownPositionIds } from '../services/appraisalTemplates.service.js';
import {
  createScoringForm, deleteScoringForm, listScoringForms, loadScoringForm, setScoringFormActive, updateScoringForm, type ScoringFormInput,
} from '../services/appraisalScoringForms.service.js';
import { IN_USE_MESSAGE } from '../services/appraisalUsage.service.js';

// Settings → Scoring forms (admins only — see the routes). A scoring form is
// built like an appraisal form's "What's scored" — weighted sections and
// criteria — with the same rules (shared in appraisalScoringSchemas).

const formSchema = z.object({
  name: z.string().trim().min(1, 'Give the scoring form a name').max(100),
  sections: scoringFormSectionsSchema.default([]),
  // Optional: which positions it's meant for.
  positionIds: z.array(z.string().max(10)).max(50).default([]),
  // Made from SOPs: which ones (kept so its steps show as an SOP check, not editable criteria).
  sopTemplateIds: z.array(z.string().max(36)).max(20).default([]),
});
const createSchema = z.object({ name: z.string().trim().min(1, 'Give the scoring form a name').max(100) });

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });
const NOT_FOUND = { message: 'Scoring form not found' };

export async function listAppraisalScoringForms(_req: Request, res: Response): Promise<void> {
  res.json(await listScoringForms());
}

export async function getAppraisalScoringForm(req: Request, res: Response): Promise<void> {
  const form = await loadScoringForm(req.params.id);
  if (!form) { res.status(404).json(NOT_FOUND); return; }
  res.json(form);
}

/** A new scoring form starts with just its name. */
export async function createAppraisalScoringForm(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  res.status(201).json(await createScoringForm({ name: parsed.data.name!, sections: [], positionIds: [] }));
}

export async function updateAppraisalScoringForm(req: Request, res: Response): Promise<void> {
  const parsed = formSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const input = { ...parsed.data, positionIds: [...new Set(parsed.data.positionIds)], sopTemplateIds: [...new Set(parsed.data.sopTemplateIds)] } as ScoringFormInput;
  if ((await unknownPositionIds(input.positionIds)).length) { res.status(400).json({ message: 'That position no longer exists — pick again.' }); return; }
  const form = await updateScoringForm(req.params.id, input);
  if (!form) { res.status(404).json(NOT_FOUND); return; }
  res.json(form);
}

const activeSchema = z.object({ active: z.boolean() });

/** Make a scoring form active (offered when picking) or inactive. */
export async function setAppraisalScoringFormActive(req: Request, res: Response): Promise<void> {
  const parsed = activeSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const form = await setScoringFormActive(req.params.id, parsed.data.active!);
  if (!form) { res.status(404).json(NOT_FOUND); return; }
  res.json(form);
}

export async function deleteAppraisalScoringForm(req: Request, res: Response): Promise<void> {
  const result = await deleteScoringForm(req.params.id);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'in-use') { res.status(409).json({ message: IN_USE_MESSAGE }); return; }
  res.status(204).end();
}
