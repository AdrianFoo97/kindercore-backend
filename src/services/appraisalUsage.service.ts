import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appraisalCriteria, appraisalCriterionPoints, appraisalSections, appraisalTemplates } from '../db/schema.js';

// Which rating scales and scoring forms appraisal forms have used. A form that
// has been live (live now, or retired) is what appraisals were or are scored
// on, so the scales and scoring forms it was built from can't be deleted any
// more — only made inactive. (Forms keep their own copy, so editing them is safe.)

export interface InUse { scaleIds: Set<string>; scoringFormIds: Set<string> }

type Config = { scaleId?: string; scoringFormId?: string; sections?: { criteria?: { scaleConfig?: Config | null }[] }[] } | null;

/** Collect the scale / scoring-form ids a criterion's (or point's) settings point at — including inside a copied scoring form. */
function collect(config: Config, into: InUse) {
  if (!config) return;
  if (config.scaleId) into.scaleIds.add(config.scaleId);
  if (config.scoringFormId) into.scoringFormIds.add(config.scoringFormId);
  for (const s of config.sections ?? []) for (const c of s.criteria ?? []) collect(c.scaleConfig ?? null, into);
}

export async function usedByForms(): Promise<InUse> {
  const used: InUse = { scaleIds: new Set(), scoringFormIds: new Set() };
  const versions = await db.select({ id: appraisalTemplates.id }).from(appraisalTemplates)
    .where(and(ne(appraisalTemplates.status, 'DRAFT'), eq(appraisalTemplates.isLegacy, false)));
  if (!versions.length) return used;
  const sections = await db.select({ id: appraisalSections.id }).from(appraisalSections).where(inArray(appraisalSections.templateId, versions.map(v => v.id)));
  if (!sections.length) return used;
  const criteria = await db.select({ id: appraisalCriteria.id, scaleConfig: appraisalCriteria.scaleConfig }).from(appraisalCriteria)
    .where(inArray(appraisalCriteria.sectionId, sections.map(s => s.id)));
  for (const c of criteria) collect(c.scaleConfig as Config, used);
  if (criteria.length) {
    const points = await db.select({ scaleConfig: appraisalCriterionPoints.scaleConfig }).from(appraisalCriterionPoints)
      .where(inArray(appraisalCriterionPoints.criterionId, criteria.map(c => c.id)));
    for (const p of points) collect(p.scaleConfig as Config, used);
  }
  return used;
}

export const IN_USE_MESSAGE = 'Appraisal forms have used it, so it can’t be deleted — make it inactive instead.';
