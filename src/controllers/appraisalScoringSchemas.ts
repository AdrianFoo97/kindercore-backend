import { z } from 'zod';

// How a criterion or a point is scored — the ONE set of rules, shared by
// appraisal forms and scoring forms (reusable sets of points).

const MAX_RATING_LEVELS = 10;
const MIN_RATING_LEVELS = 2;
const DEFAULT_RATING_MAX = 5;

const ratingConfig = z.object({
  /** The rating scale (Settings → Rating scales) these levels were copied from, if any. */
  scaleId: z.string().max(36).optional(),
  max: z.number().int().min(MIN_RATING_LEVELS).max(MAX_RATING_LEVELS),
  levels: z.array(z.object({
    value: z.number().int().min(1).max(MAX_RATING_LEVELS),
    label: z.string().trim().max(60),
    description: z.string().trim().max(300).optional(),
  })).max(MAX_RATING_LEVELS).optional(),
});
const numberConfig = z.object({ target: z.number().positive('A target has to be above 0'), higherIsBetter: z.boolean() });
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;
const MAX_LEVEL_LABEL = 40;
/** Named levels, each worth 0–100% (e.g. Fail 0, Satisfactory 60, Excellent 100); where they came from is kept for the editor. */
const levelsConfig = z.object({
  levels: z.array(z.object({ label: z.string().trim().min(1, 'Every level needs a name').max(MAX_LEVEL_LABEL), score: z.number().min(0).max(100) }))
    .min(MIN_LEVELS, `Give at least ${MIN_LEVELS} levels`).max(MAX_LEVELS, `Use at most ${MAX_LEVELS} levels`)
    .refine(ls => new Set(ls.map(l => l.label.toLowerCase())).size === ls.length, 'Two levels have the same name'),
  source: z.object({ kind: z.enum(['SCALE', 'ONE_TO_FIVE', 'CUSTOM']), scaleId: z.string().max(36).optional() }).optional(),
});

// Automatic scores (from SOP checks, incidents…) arrive in a later update, so
// only manually entered kinds can be chosen for now.
export const MANUAL_INPUTS = ['RATING', 'PERCENT', 'YES_NO', 'PASS_FAIL', 'LEVELS', 'NUMBER'] as const;
export type ManualInput = typeof MANUAL_INPUTS[number];
/** How a point is scored when it doesn't say. */
export const DEFAULT_POINT_INPUT: ManualInput = 'RATING';

/**
 * Only the settings that belong to the chosen kind of input (a criterion's or
 * a point's) — or an error in plain words. undefined = invalid (issue added).
 */
export function cleanScale(name: string, inputType: ManualInput | 'POINTS', raw: unknown, ctx: z.RefinementCtx): Record<string, unknown> | null | undefined {
  if (inputType === 'RATING') {
    const parsed = ratingConfig.safeParse(raw ?? { max: DEFAULT_RATING_MAX });
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: `"${name}": ${parsed.error.errors[0].message}` }); return undefined; }
    return {
      ...(parsed.data.scaleId ? { scaleId: parsed.data.scaleId } : {}),
      max: parsed.data.max, levels: (parsed.data.levels ?? []).filter(l => l.value <= parsed.data.max && (l.label || l.description)),
    };
  }
  if (inputType === 'LEVELS') {
    const parsed = levelsConfig.safeParse(raw);
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: `"${name}": ${parsed.error.errors[0].message}` }); return undefined; }
    return parsed.data;
  }
  if (inputType === 'NUMBER') {
    const parsed = numberConfig.safeParse(raw);
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: `"${name}" needs a target above 0` }); return undefined; }
    return parsed.data;
  }
  return null;
}

export const pointSchema = z.object({
  name: z.string().trim().min(1, 'Every point needs a name').max(191),
  // What it means (e.g. an SOP step's detail) — kept in scoring forms, shown while scoring.
  description: z.string().trim().max(1000).nullable().optional(),
  // Left out = scored the criterion's way (older clients).
  inputType: z.enum(MANUAL_INPUTS).optional(),
  scaleConfig: z.unknown().optional(),
});

// ── Sections → criteria (→ points): the body of an appraisal form, and of a
// scoring form. A criterion on an appraisal form can also be scored "from a
// scoring form" (FORM): it then carries a COPY of that form's sections, so a
// later change to the scoring form never changes the appraisal form.

// Room for an SOP check of many SOPs (one section each).
const MAX_SECTIONS = 20;
// High enough for a whole SOP in one section (an SOP check is scored like an observation: passed ÷ decided).
const MAX_CRITERIA_PER_SECTION = 100;
// High enough for a whole SOP's steps as one criterion's items.
const MAX_POINTS_PER_CRITERION = 100;
const FULL_WEIGHT = 100;
const WEIGHT_TOLERANCE = 0.01;

/** A criterion can also be scored on its points (their average) — chosen before any are added. */
const BASIC_CRITERION_INPUTS = [...MANUAL_INPUTS, 'POINTS'] as const;
/** …or, on an appraisal form only, from a scoring form (never a scoring form inside a scoring form). */
const FORM_CRITERION_INPUTS = [...BASIC_CRITERION_INPUTS, 'FORM'] as const;

/** A draft may still be short of 100% while being built, but never over it. */
function refuseOverWeight(sections: { name?: string; weight?: number; criteria?: { weight?: number }[] }[], ctx: z.RefinementCtx) {
  const over = (weights: number[]) => weights.reduce((a, b) => a + b, 0) > FULL_WEIGHT + WEIGHT_TOLERANCE;
  if (over(sections.map(s => s.weight ?? 0))) ctx.addIssue({ code: 'custom', message: 'Section weights add up to more than 100%.' });
  for (const s of sections) {
    if (over((s.criteria ?? []).map(c => c.weight ?? 0))) ctx.addIssue({ code: 'custom', message: `Criteria in "${s.name}" add up to more than 100%.` });
  }
}

function criterionSchema<T extends z.ZodTypeAny>(inputs: readonly [string, ...string[]], formSnapshot: T | null) {
  return z.object({
    name: z.string().trim().min(1, 'Every criterion needs a name').max(191),
    description: z.string().trim().max(1000).nullable().optional(),
    weight: z.number().min(0).max(100),
    inputType: z.enum(inputs as [ManualInput | 'POINTS' | 'FORM', ...(ManualInput | 'POINTS' | 'FORM')[]]),
    scaleConfig: z.unknown().optional(),
    points: z.array(pointSchema).max(MAX_POINTS_PER_CRITERION).default([]),
    // An SOP check's criterion: the SOP it scores — so a later edit to the SOP can reach new appraisals.
    sopTemplateId: z.string().max(36).nullable().optional(),
  }).transform((c, ctx) => {
    let scaleConfig: Record<string, unknown> | null | undefined;
    if (c.inputType === 'FORM') {
      // The scoring form it was copied from: its id and name (for showing), and its sections.
      const parsed = formSnapshot?.safeParse(c.scaleConfig);
      if (!parsed?.success) { ctx.addIssue({ code: 'custom', message: `"${c.name}" needs a complete scoring form — pick it again` }); return z.NEVER; }
      scaleConfig = parsed.data as Record<string, unknown>;
    } else {
      scaleConfig = cleanScale(c.name!, c.inputType as ManualInput | 'POINTS', c.scaleConfig, ctx);
    }
    if (scaleConfig === undefined) return z.NEVER;
    const points = [];
    if (c.inputType !== 'FORM') {
      for (const p of c.points ?? []) {
        // A point that doesn't say how it's scored is scored the criterion's way (older clients).
        const own = p.inputType != null;
        const inputType = p.inputType ?? (c.inputType === 'POINTS' ? DEFAULT_POINT_INPUT : c.inputType as ManualInput);
        const pointScale = own ? cleanScale(p.name!, inputType, p.scaleConfig, ctx) : scaleConfig;
        if (pointScale === undefined) return z.NEVER;
        points.push({ name: p.name!, ...(p.description ? { description: p.description } : {}), inputType, scaleConfig: pointScale });
      }
    }
    return { name: c.name!, description: c.description || null, weight: c.weight!, inputType: c.inputType as ManualInput | 'POINTS' | 'FORM', scaleConfig, points, ...(c.sopTemplateId ? { sopTemplateId: c.sopTemplateId } : {}) };
  });
}

function sectionsSchema<T extends z.ZodTypeAny>(inputs: readonly [string, ...string[]], formSnapshot: T | null) {
  return z.array(z.object({
    name: z.string().trim().min(1, 'Every section needs a name').max(191),
    weight: z.number().min(0).max(100),
    criteria: z.array(criterionSchema(inputs, formSnapshot)).max(MAX_CRITERIA_PER_SECTION),
  })).max(MAX_SECTIONS).superRefine(refuseOverWeight);
}

/** The body of a scoring form: its criteria are scored directly — no "on several points", no scoring form. */
// A scoring form's criteria can be scored directly or on their items (e.g. an SOP: its steps) — never from another scoring form.
export const scoringFormSectionsSchema = sectionsSchema(BASIC_CRITERION_INPUTS, null);

/** What a FORM criterion keeps: which scoring form, its name, and a copy of its sections. */
const formSnapshotSchema = z.object({
  scoringFormId: z.string().max(36),
  name: z.string().trim().min(1).max(100),
  sections: scoringFormSectionsSchema.refine(s => s.length > 0, 'The scoring form has nothing to score'),
});

/** The body of an appraisal form. */
export const appraisalSectionsSchema = sectionsSchema(FORM_CRITERION_INPUTS, formSnapshotSchema);
