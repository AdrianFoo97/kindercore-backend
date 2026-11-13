import { Request, Response } from 'express';
import { z } from 'zod';
import {
  STARTER_STAGES, activateTemplate, createTemplate, deleteDraft, listTemplateFamilies, loadTemplate, retireTemplate,
  saveDraft, setFamilyPositions, startNewVersion, unknownPositionIds, type TemplateInput,
} from '../services/appraisalTemplates.service.js';

// Settings → HR & Payroll → Appraisal templates (admin only — see the routes).
// Drafts are edited as one whole document; live versions are read-only and
// "Edit" opens a new draft version. Rules live in appraisalTemplates.service.

const MAX_SECTIONS = 10;
const MAX_CRITERIA_PER_SECTION = 30;
const MAX_STAGES = 8;
const MAX_POINTS_PER_CRITERION = 20;
const MAX_RATING_LEVELS = 10;
const MIN_RATING_LEVELS = 2;
const DEFAULT_RATING_MAX = 5;
const FULL_WEIGHT = 100;
const WEIGHT_TOLERANCE = 0.01;

const ratingConfig = z.object({
  max: z.number().int().min(MIN_RATING_LEVELS).max(MAX_RATING_LEVELS),
  levels: z.array(z.object({
    value: z.number().int().min(1).max(MAX_RATING_LEVELS),
    label: z.string().trim().max(60),
    description: z.string().trim().max(300).optional(),
  })).max(MAX_RATING_LEVELS).optional(),
});
const numberConfig = z.object({ target: z.number().positive('A target has to be above 0'), higherIsBetter: z.boolean() });

// Automatic scores (from SOP checks, incidents…) arrive in a later update, so
// only manually entered kinds can be chosen for now.
const MANUAL_INPUTS = ['RATING', 'PERCENT', 'YES_NO', 'NUMBER'] as const;

const criterionSchema = z.object({
  name: z.string().trim().min(1, 'Every criterion needs a name').max(191),
  description: z.string().trim().max(1000).nullable().optional(),
  weight: z.number().min(0).max(100),
  inputType: z.enum(MANUAL_INPUTS),
  scaleConfig: z.unknown().optional(),
  points: z.array(z.object({ name: z.string().trim().min(1, 'Every point needs a name').max(191) })).max(MAX_POINTS_PER_CRITERION).default([]),
}).transform((c, ctx) => {
  // Keep only the settings that belong to the chosen kind of input.
  let scaleConfig: Record<string, unknown> | null = null;
  if (c.inputType === 'RATING') {
    const parsed = ratingConfig.safeParse(c.scaleConfig ?? { max: DEFAULT_RATING_MAX });
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: `"${c.name}": ${parsed.error.errors[0].message}` }); return z.NEVER; }
    scaleConfig = { max: parsed.data.max, levels: (parsed.data.levels ?? []).filter(l => l.value <= parsed.data.max && (l.label || l.description)) };
  } else if (c.inputType === 'NUMBER') {
    const parsed = numberConfig.safeParse(c.scaleConfig);
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: `"${c.name}" needs a target above 0` }); return z.NEVER; }
    scaleConfig = parsed.data;
  }
  return { name: c.name, description: c.description || null, weight: c.weight, inputType: c.inputType, scaleConfig, points: c.points ?? [] };
});

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Give the form a name').max(191),
  description: z.string().trim().max(2000).nullable().optional(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
  missingPolicy: z.enum(['REQUIRE_ALL', 'REWEIGHT']).default('REQUIRE_ALL'),
  sections: z.array(z.object({
    name: z.string().trim().min(1, 'Every section needs a name').max(191),
    weight: z.number().min(0).max(100),
    criteria: z.array(criterionSchema).max(MAX_CRITERIA_PER_SECTION),
  })).max(MAX_SECTIONS),
  stages: z.array(z.object({
    name: z.string().trim().min(1, 'Every step needs a name').max(100),
    kind: z.enum(['ASSESS', 'SIGN_OFF', 'ACKNOWLEDGE']),
    scope: z.enum(['ANYONE', 'OWN_TEAM']).default('ANYONE'),
    positionIds: z.array(z.string().max(10)).max(50),
  })).min(1, 'Add who assesses it').max(MAX_STAGES),
}).superRefine((t, ctx) => {
  // A draft may still be short of 100% while being built, but never over it.
  const over = (weights: number[]) => weights.reduce((a, b) => a + b, 0) > FULL_WEIGHT + WEIGHT_TOLERANCE;
  if (over(t.sections.map(s => s.weight))) ctx.addIssue({ code: 'custom', message: 'Section weights add up to more than 100%.' });
  for (const s of t.sections) {
    if (over(s.criteria.map(c => c.weight))) ctx.addIssue({ code: 'custom', message: `Criteria in "${s.name}" add up to more than 100%.` });
  }
});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the form a name').max(191),
  description: z.string().trim().max(2000).nullable().optional(),
});

const positionsSchema = z.object({ positionIds: z.array(z.string().max(10)).max(50) });

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

const NOT_FOUND = { message: 'Appraisal form not found' };
const NOT_DRAFT = { message: 'Only a draft can be changed — open a new version to edit a live form.' };

async function sendTemplate(res: Response, id: string, status = 200) {
  const t = await loadTemplate(id);
  if (!t) { res.status(404).json(NOT_FOUND); return; }
  res.status(status).json(t);
}

export async function listAppraisalTemplates(_req: Request, res: Response): Promise<void> {
  res.json(await listTemplateFamilies());
}

export async function getAppraisalTemplate(req: Request, res: Response): Promise<void> {
  await sendTemplate(res, req.params.id);
}

/** A new form starts as a draft with the usual chain (assess → sign off → acknowledge) and no sections. */
export async function createAppraisalTemplate(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const id = await createTemplate({
    name: parsed.data.name, description: parsed.data.description || null,
    frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL', sections: [], stages: STARTER_STAGES,
  });
  await sendTemplate(res, id, 201);
}

export async function updateAppraisalTemplate(req: Request, res: Response): Promise<void> {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  // (Non-strict TS reads every zod field as optional; the schema has required them.)
  const input = { ...parsed.data, description: parsed.data.description || null } as TemplateInput;
  const unknown = await unknownPositionIds(input.stages.flatMap(s => s.positionIds));
  if (unknown.length) { res.status(400).json({ message: 'A step uses a position that no longer exists — pick again.' }); return; }
  const result = await saveDraft(req.params.id, input);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'not-draft') { res.status(409).json(NOT_DRAFT); return; }
  await sendTemplate(res, req.params.id);
}

/** Opens the draft to edit (an existing one, or a copy of this version). */
export async function newAppraisalTemplateVersion(req: Request, res: Response): Promise<void> {
  const draftId = await startNewVersion(req.params.id);
  if (!draftId) { res.status(404).json(NOT_FOUND); return; }
  await sendTemplate(res, draftId);
}

export async function activateAppraisalTemplate(req: Request, res: Response): Promise<void> {
  const result = await activateTemplate(req.params.id);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'not-draft') { res.status(409).json({ message: 'Only a draft can be made live.' }); return; }
  if (typeof result === 'object') {
    res.status(400).json({ message: 'Fix these first', problems: result.problems, errors: result.problems.map(message => ({ message })) });
    return;
  }
  await sendTemplate(res, req.params.id);
}

export async function retireAppraisalTemplate(req: Request, res: Response): Promise<void> {
  const result = await retireTemplate(req.params.id);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'not-draft') { res.status(409).json({ message: 'Only a live form can be retired.' }); return; }
  await sendTemplate(res, req.params.id);
}

export async function deleteAppraisalTemplate(req: Request, res: Response): Promise<void> {
  const result = await deleteDraft(req.params.id);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (result === 'not-draft') { res.status(409).json({ message: 'Only a draft can be deleted — retire a live form instead.' }); return; }
  res.status(204).end();
}

/** Which positions use this form (all its versions). */
export async function setAppraisalTemplatePositions(req: Request, res: Response): Promise<void> {
  const parsed = positionsSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  if ((await unknownPositionIds(parsed.data.positionIds)).length) {
    res.status(400).json({ message: 'That position no longer exists — pick again.' });
    return;
  }
  const result = await setFamilyPositions(req.params.familyId, parsed.data.positionIds);
  if (result === 'not-found') { res.status(404).json(NOT_FOUND); return; }
  if (typeof result === 'object') {
    const t = result.taken[0];
    res.status(409).json({ message: `That position already uses "${t.templateName}". Take it off there first.`, taken: result.taken });
    return;
  }
  res.json({ positionIds: [...new Set(parsed.data.positionIds)] });
}
