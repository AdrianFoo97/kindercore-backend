import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appraisalScoringForms, appraisalTemplates, sopSteps, sopTemplates } from '../db/schema.js';
import { loadTemplate, publishRevision } from './appraisalTemplates.service.js';
import { refreshSopSections, sameContent, type SopNow } from './sopRefresh.logic.js';

// Before an appraisal is created: if an SOP its form scores was edited since the
// form copied it — or the SOP scoring form itself was changed (its SOPs, shares,
// how steps are marked) — a new version of the form goes live with it as it is now
// (and the scoring form is brought up to date with its SOPs too). The
// appraisal is then created on that version; appraisals already created keep
// theirs. Rules in sopRefresh.logic.

interface FormCopy { scoringFormId: string; name: string; sections: { criteria: { sopTemplateId?: string | null; inputType: string; name: string }[] }[] }

const isFormCopy = (v: unknown): v is FormCopy => !!v && typeof v === 'object' && Array.isArray((v as FormCopy).sections);

/** These SOPs as they are now: title and live steps (deleted ones left out). */
async function sopsNow(ids: string[]): Promise<Map<string, SopNow>> {
  if (ids.length === 0) return new Map();
  const [templates, steps] = await Promise.all([
    db.select({ id: sopTemplates.id, title: sopTemplates.title }).from(sopTemplates).where(and(inArray(sopTemplates.id, ids), isNull(sopTemplates.deletedAt))),
    db.select({ sopTemplateId: sopSteps.sopTemplateId, section: sopSteps.section, title: sopSteps.title, detail: sopSteps.detail, displayOrder: sopSteps.displayOrder })
      .from(sopSteps).where(and(inArray(sopSteps.sopTemplateId, ids), isNull(sopSteps.deletedAt))),
  ]);
  return new Map(templates.map(t => [t.id, { id: t.id, title: t.title, steps: steps.filter(s => s.sopTemplateId === t.id) }]));
}

/** Make sure the live version of this appraisal form scores its SOPs as they are now. Returns the live version's id. */
export async function keepSopsCurrent(familyId: string): Promise<string | null> {
  const [live] = await db.select({ id: appraisalTemplates.id }).from(appraisalTemplates)
    .where(and(eq(appraisalTemplates.familyId, familyId), eq(appraisalTemplates.status, 'ACTIVE')));
  if (!live) return null;
  const template = await loadTemplate(live.id);
  if (!template) return live.id;
  const copies = template.sections.flatMap(s => s.criteria).filter(c => c.inputType === 'FORM' && isFormCopy(c.scaleConfig))
    .map(c => ({ criterionId: c.id, copy: c.scaleConfig as unknown as FormCopy }));
  if (copies.length === 0) return live.id;

  const formIds = [...new Set(copies.map(c => c.copy.scoringFormId))];
  const forms = await db.select().from(appraisalScoringForms).where(inArray(appraisalScoringForms.id, formIds));
  const formSops = new Map(forms.map(f => [f.id, (f.sopTemplateIds ?? []) as string[]]));
  const sopIds = [...new Set([
    ...forms.flatMap(f => (f.sopTemplateIds ?? []) as string[]),
    ...copies.flatMap(c => c.copy.sections.flatMap(s => s.criteria.map(x => x.sopTemplateId).filter((x): x is string => !!x))),
  ])];
  if (sopIds.length === 0) return live.id;
  const sops = await sopsNow(sopIds);

  // The SOP scoring forms themselves (Settings → Scoring forms) — kept current with their SOPs.
  const sopFormNow = new Map<string, { name: string; sections: unknown[] }>();
  for (const f of forms) {
    const r = refreshSopSections((f.sections ?? []) as never[], sops, formSops.get(f.id));
    if (r.changed) await db.update(appraisalScoringForms).set({ sections: r.sections, updatedAt: new Date() }).where(eq(appraisalScoringForms.id, f.id));
    if ((formSops.get(f.id) ?? []).length) sopFormNow.set(f.id, { name: f.name, sections: r.sections });
  }
  const revised = new Map<string, Record<string, unknown>>();
  for (const { criterionId, copy } of copies) {
    // An SOP scoring form: new appraisals use it as it is now — its SOPs, shares and how steps are marked.
    const now = sopFormNow.get(copy.scoringFormId);
    if (now) {
      if (!sameContent(copy.sections, now.sections) || copy.name !== now.name) revised.set(criterionId, { ...copy, name: now.name, sections: now.sections });
      continue;
    }
    // Any other copy (its scoring form gone, or built by hand): only its SOP steps are brought up to date.
    const r = refreshSopSections(copy.sections as never[], sops, formSops.get(copy.scoringFormId));
    if (r.changed) revised.set(criterionId, { ...copy, sections: r.sections });
  }
  if (revised.size === 0) return live.id;
  return (await publishRevision(live.id, revised)) ?? live.id;
}
