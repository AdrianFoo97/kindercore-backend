import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  appraisalCriteria, appraisalScores, appraisalSections, appraisalTemplates, appraisals, teacherAppraisals,
} from '../db/schema.js';
import { normaliseCriterion } from './appraisalScoring.service.js';

// Appraisals from before the template engine (TeacherAppraisal: one score per
// staff member per month) mirrored into the engine's tables, on a built-in
// "Legacy overall score" template — one section, one 0–100 criterion, both
// 100% — so nothing is lost when the screens move to the engine. Idempotent:
// adds what's missing, updates what changed, removes copies whose source was
// deleted. Runs at startup until the screens switch over.

export const LEGACY_TEMPLATE_ID = 'legacy-appraisal-template';
export const LEGACY_SECTION_ID = 'legacy-appraisal-section';
export const LEGACY_CRITERION_ID = 'legacy-appraisal-criterion';
const LEGACY_INPUT = { inputType: 'PERCENT' as const };

type Exec = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** The built-in legacy template (created once). */
export async function ensureLegacyTemplate(exec: Exec = db): Promise<void> {
  const [existing] = await exec.select({ id: appraisalTemplates.id }).from(appraisalTemplates).where(eq(appraisalTemplates.id, LEGACY_TEMPLATE_ID));
  if (existing) return;
  const now = new Date();
  await exec.insert(appraisalTemplates).values({
    id: LEGACY_TEMPLATE_ID, familyId: LEGACY_TEMPLATE_ID, name: 'Legacy overall score',
    description: 'Appraisals recorded before templates — one overall score out of 100.',
    frequency: 'MONTHLY', status: 'RETIRED', version: 1, missingPolicy: 'REQUIRE_ALL', isLegacy: true, createdAt: now, updatedAt: now,
  });
  await exec.insert(appraisalSections).values({ id: LEGACY_SECTION_ID, templateId: LEGACY_TEMPLATE_ID, name: 'Overall', weight: 100, sortOrder: 0 });
  await exec.insert(appraisalCriteria).values({
    id: LEGACY_CRITERION_ID, sectionId: LEGACY_SECTION_ID, name: 'Overall score', weight: 100, inputType: 'PERCENT', sortOrder: 0,
  });
}

/** Mirror every TeacherAppraisal into the engine. Returns what changed. */
export async function syncLegacyAppraisals(): Promise<{ added: number; updated: number; removed: number }> {
  return db.transaction(async tx => {
    await ensureLegacyTemplate(tx);
    // Scores written by appraisals done with a form already live in the engine — they aren't copied again.
    const sources = (await tx.select().from(teacherAppraisals)).filter(s => !s.engineAppraisalId);
    const copies = await tx.select().from(appraisals).where(eq(appraisals.templateId, LEGACY_TEMPLATE_ID));
    const copyBySource = new Map(copies.filter(c => c.legacyAppraisalId).map(c => [c.legacyAppraisalId!, c]));
    const sourceIds = new Set(sources.map(s => s.id));
    let added = 0;
    let updated = 0;

    for (const s of sources) {
      const normalised = normaliseCriterion(LEGACY_INPUT, s.score);
      const copy = copyBySource.get(s.id);
      const fields = {
        teacherId: s.teacherId, periodYear: s.year, periodMonth: s.month, totalScore: normalised,
        comments: s.notes, assessedByName: s.evaluatedBy, completedAt: s.updatedAt, updatedAt: s.updatedAt,
      };
      if (!copy) {
        const id = randomUUID();
        await tx.insert(appraisals).values({
          id, templateId: LEGACY_TEMPLATE_ID, status: 'COMPLETED', currentStageOrder: null, legacyAppraisalId: s.id,
          createdAt: s.createdAt, ...fields,
        });
        await tx.insert(appraisalScores).values({ id: randomUUID(), appraisalId: id, criterionId: LEGACY_CRITERION_ID, rawValue: s.score, normalised });
        added++;
      } else if (
        copy.totalScore !== normalised || copy.comments !== s.notes || copy.assessedByName !== s.evaluatedBy
        || copy.periodYear !== s.year || copy.periodMonth !== s.month || copy.teacherId !== s.teacherId
      ) {
        await tx.update(appraisals).set(fields).where(eq(appraisals.id, copy.id));
        await tx.update(appraisalScores).set({ rawValue: s.score, normalised }).where(eq(appraisalScores.appraisalId, copy.id));
        updated++;
      }
    }

    const orphans = copies.filter(c => c.legacyAppraisalId && !sourceIds.has(c.legacyAppraisalId)).map(c => c.id);
    if (orphans.length) {
      await tx.delete(appraisalScores).where(inArray(appraisalScores.appraisalId, orphans));
      await tx.delete(appraisals).where(inArray(appraisals.id, orphans));
    }
    return { added, updated, removed: orphans.length };
  });
}
