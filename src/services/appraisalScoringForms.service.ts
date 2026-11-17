import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appraisalScoringForms } from '../db/schema.js';
import { checkTemplate, type SectionDef } from './appraisalScoring.service.js';
import { usedByForms } from './appraisalUsage.service.js';

// Settings → Scoring forms: reusable "What's scored" bodies (weighted sections
// and criteria) that an appraisal criterion can be scored from. The criterion
// keeps a COPY, so editing or deleting a scoring form never changes an
// appraisal form — never a live one. A scoring form with problems (weights not
// making 100%, nothing to score…) can't be picked until it's fixed.

export interface ScoringFormInput {
  name: string;
  sections: unknown[];
  /** Optional: which positions it's meant for (shown when picking it — not a restriction). */
  positionIds: string[];
  /** Made from these SOPs — its steps are checked pass / fail / N/A and aren't edited by hand. Empty = built by hand. */
  sopTemplateIds?: string[];
}
export interface ScoringForm extends ScoringFormInput {
  id: string; isActive: boolean; problems: string[];
  /** Used by a form that's been live — can't be deleted, only made inactive. */
  inUse?: boolean;
}

/** What stops it being used, in the same words as an appraisal form's checks. */
function problemsOf(sections: unknown[]): string[] {
  // Saved sections have no ids; the checks only read names, weights and kinds.
  const defs = sections.map((s, i) => ({ id: String(i), ...(s as object) })) as unknown as SectionDef[];
  return checkTemplate({ missingPolicy: 'REQUIRE_ALL', sections: defs.map(s => ({ ...s, criteria: s.criteria.map((c, j) => ({ ...c, id: String(j) })) })) });
}

const toForm = (r: typeof appraisalScoringForms.$inferSelect): ScoringForm => {
  const sections = (r.sections ?? []) as unknown[];
  return {
    id: r.id, name: r.name, sections, positionIds: (r.positionIds ?? []) as string[], sopTemplateIds: (r.sopTemplateIds ?? []) as string[],
    isActive: r.isActive, problems: problemsOf(sections),
  };
};

/** By name. */
export async function listScoringForms(): Promise<ScoringForm[]> {
  const used = await usedByForms();
  return (await db.select().from(appraisalScoringForms).orderBy(asc(appraisalScoringForms.name))).map(r => ({ ...toForm(r), inUse: used.scoringFormIds.has(r.id) }));
}

export async function loadScoringForm(id: string): Promise<ScoringForm | null> {
  const [row] = await db.select().from(appraisalScoringForms).where(eq(appraisalScoringForms.id, id));
  return row ? { ...toForm(row), inUse: (await usedByForms()).scoringFormIds.has(id) } : null;
}

export async function createScoringForm(input: ScoringFormInput): Promise<ScoringForm> {
  const now = new Date();
  const row = { id: randomUUID(), ...input, sopTemplateIds: input.sopTemplateIds ?? [], isActive: true, createdAt: now, updatedAt: now };
  await db.insert(appraisalScoringForms).values(row);
  return toForm(row);
}

export async function updateScoringForm(id: string, input: ScoringFormInput): Promise<ScoringForm | null> {
  const result = await db.update(appraisalScoringForms).set({ ...input, updatedAt: new Date() }).where(eq(appraisalScoringForms.id, id));
  if (!(result as any)[0]?.affectedRows) return null;
  return loadScoringForm(id);
}

/** Offer it when picking a scoring form, or not. */
export async function setScoringFormActive(id: string, active: boolean): Promise<ScoringForm | null> {
  const result = await db.update(appraisalScoringForms).set({ isActive: active, updatedAt: new Date() }).where(eq(appraisalScoringForms.id, id));
  if (!(result as any)[0]?.affectedRows) return null;
  return loadScoringForm(id);
}

/** Delete — unless a form that's been live used it (then it can only be made inactive). */
export async function deleteScoringForm(id: string): Promise<'ok' | 'not-found' | 'in-use'> {
  if ((await usedByForms()).scoringFormIds.has(id)) return 'in-use';
  const result = await db.delete(appraisalScoringForms).where(eq(appraisalScoringForms.id, id));
  return (result as any)[0]?.affectedRows ? 'ok' : 'not-found';
}
