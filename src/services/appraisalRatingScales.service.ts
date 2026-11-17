import { randomUUID } from 'crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appraisalRatingScales } from '../db/schema.js';
import { usedByForms } from './appraisalUsage.service.js';

// Settings → Rating scales: named rating scales whose level wording a criterion
// (or point) copies when it's scored on a rating. Exactly one is the default.
// A criterion keeps its own copy, so editing or deleting a scale never changes
// a form already built — and never a live one.

export interface RatingLevel { value: number; label: string; description?: string }
export interface RatingScaleInput { name: string; max: number; levels: RatingLevel[] }
export interface RatingScale extends RatingScaleInput {
  id: string; isDefault: boolean; isActive: boolean;
  /** Used by a form that's been live — can't be deleted, only made inactive. */
  inUse?: boolean;
}

/** The scale every school starts with. */
export const STARTER_SCALE: RatingScaleInput = {
  name: 'Standard 1–5',
  max: 5,
  levels: [
    { value: 1, label: 'Needs improvement', description: 'Rarely meets what’s expected; needs close support.' },
    { value: 2, label: 'Developing', description: 'Sometimes meets what’s expected; still learning.' },
    { value: 3, label: 'Meets expectations', description: 'Reliably does what’s expected.' },
    { value: 4, label: 'Exceeds expectations', description: 'Often goes beyond what’s expected.' },
    { value: 5, label: 'Outstanding', description: 'Consistently excellent; a model for others.' },
  ],
};

const toScale = (r: typeof appraisalRatingScales.$inferSelect): RatingScale => ({
  id: r.id, name: r.name, max: r.max, levels: (r.levels ?? []) as RatingLevel[], isDefault: r.isDefault, isActive: r.isActive,
});

/** Default first, then by name. */
export async function listRatingScales(): Promise<RatingScale[]> {
  const rows = await db.select().from(appraisalRatingScales).orderBy(desc(appraisalRatingScales.isDefault), asc(appraisalRatingScales.name));
  const used = await usedByForms();
  return rows.map(r => ({ ...toScale(r), inUse: used.scaleIds.has(r.id) }));
}

/** Adds the starter scale when there are none (run at startup). */
export async function ensureStarterRatingScale(): Promise<void> {
  const [any] = await db.select({ id: appraisalRatingScales.id }).from(appraisalRatingScales).limit(1);
  if (!any) await createRatingScale(STARTER_SCALE);
}

/** The first scale becomes the default. */
export async function createRatingScale(input: RatingScaleInput): Promise<RatingScale> {
  const [existing] = await db.select({ id: appraisalRatingScales.id }).from(appraisalRatingScales).limit(1);
  const now = new Date();
  const row = { id: randomUUID(), ...input, isDefault: !existing, isActive: true, createdAt: now, updatedAt: now };
  await db.insert(appraisalRatingScales).values(row);
  return toScale(row);
}

export async function updateRatingScale(id: string, input: RatingScaleInput): Promise<RatingScale | null> {
  const result = await db.update(appraisalRatingScales).set({ ...input, updatedAt: new Date() }).where(eq(appraisalRatingScales.id, id));
  if (!(result as any)[0]?.affectedRows) return null;
  const [row] = await db.select().from(appraisalRatingScales).where(eq(appraisalRatingScales.id, id));
  return toScale(row);
}

/** Makes this the one default (preselected for new criteria). */
export async function setDefaultRatingScale(id: string): Promise<'ok' | 'not-found'> {
  return db.transaction(async tx => {
    const [row] = await tx.select({ id: appraisalRatingScales.id }).from(appraisalRatingScales).where(eq(appraisalRatingScales.id, id));
    if (!row) return 'not-found';
    await tx.update(appraisalRatingScales).set({ isDefault: false }).where(eq(appraisalRatingScales.isDefault, true));
    // The default is always offered, so it's made active too.
    await tx.update(appraisalRatingScales).set({ isDefault: true, isActive: true }).where(eq(appraisalRatingScales.id, id));
    return 'ok';
  });
}

/** Offer it when picking a scale, or not. The default can't be made inactive. */
export async function setRatingScaleActive(id: string, active: boolean): Promise<RatingScale | 'not-found' | 'is-default'> {
  const [row] = await db.select().from(appraisalRatingScales).where(eq(appraisalRatingScales.id, id));
  if (!row) return 'not-found';
  if (!active && row.isDefault) return 'is-default';
  await db.update(appraisalRatingScales).set({ isActive: active, updatedAt: new Date() }).where(eq(appraisalRatingScales.id, id));
  return toScale({ ...row, isActive: active });
}

/** The default can't be deleted — make another one the default first. */
export async function deleteRatingScale(id: string): Promise<'ok' | 'not-found' | 'is-default' | 'in-use'> {
  const [row] = await db.select().from(appraisalRatingScales).where(eq(appraisalRatingScales.id, id));
  if (!row) return 'not-found';
  if (row.isDefault) return 'is-default';
  if ((await usedByForms()).scaleIds.has(id)) return 'in-use';
  await db.delete(appraisalRatingScales).where(eq(appraisalRatingScales.id, id));
  return 'ok';
}
