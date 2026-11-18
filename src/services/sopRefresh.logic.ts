// Appraisals scored on SOPs use the SOPs as they are when the appraisal is
// created: an SOP edited since its scoring form (or the appraisal form's copy
// of it) was made has its steps brought up to date for NEW appraisals, while
// appraisals already created keep the steps they were made with. Pure rules —
// the database side is in sopRefresh.service.

/** Same limits and naming as the Settings screen that builds an SOP scoring form (scoringForms.ts sectionsFromSops). */
const MAX_STEP_NAME = 191;
const MAX_DESCRIPTION = 1000;

export interface SopStepNow { section: string; title: string; detail: string | null; displayOrder: number }
export interface SopNow { id: string; title: string; steps: SopStepNow[] }

/** How a form marks its SOP steps: pass / fail, or named levels (each with N/A). */
export interface StepMarking { inputType: 'PASS_FAIL' | 'LEVELS'; scaleConfig: Record<string, unknown> | null }
export const PASS_FAIL_MARKING: StepMarking = { inputType: 'PASS_FAIL', scaleConfig: null };
export interface SopPoint extends StepMarking { name: string; description: string | null }
interface Criterion { name: string; inputType: string; points?: { name: string; description?: string | null; inputType?: string; scaleConfig?: unknown }[]; sopTemplateId?: string | null; [k: string]: unknown }
interface Section { criteria: Criterion[]; [k: string]: unknown }

/** An SOP's live steps as points marked `marking`'s way (with N/A), in order — named "Section · Step" when it has several sections. */
export function pointsFromSop(sop: SopNow, marking: StepMarking = PASS_FAIL_MARKING): SopPoint[] {
  const steps = [...sop.steps].sort((a, b) => a.displayOrder - b.displayOrder);
  const severalSections = new Set(steps.map(s => s.section.trim())).size > 1;
  return steps.map(s => ({
    name: (severalSections && s.section.trim() ? `${s.section.trim()} · ${s.title.trim()}` : s.title.trim()).slice(0, MAX_STEP_NAME),
    description: s.detail?.trim().slice(0, MAX_DESCRIPTION) || null,
    inputType: marking.inputType,
    scaleConfig: marking.scaleConfig,
  }));
}

const samePoints = (a: { name: string; description?: string | null }[], b: SopPoint[]) =>
  a.length === b.length && a.every((p, i) => p.name === b[i].name && (p.description ?? null) === b[i].description);

/**
 * Bring each SOP criterion up to date with its SOP as it is now. A criterion is
 * matched by the SOP it remembers (sopTemplateId), or — on a form made before it
 * remembered — by its name among `formSopIds` (the SOPs its scoring form was made
 * from). An SOP that's gone or has no steps is left as it was (nothing to score).
 * `changed` is true only when the steps or the SOP's name differ.
 */
export function refreshSopSections<S extends Section>(sections: S[], sops: Map<string, SopNow>, formSopIds: string[] = []): { sections: S[]; changed: boolean } {
  let changed = false;
  const byTitle = new Map(formSopIds.map(id => sops.get(id)).filter((s): s is SopNow => !!s).map(s => [s.title.trim(), s]));
  const out = sections.map(sec => ({
    ...sec,
    criteria: sec.criteria.map(c => {
      if (c.inputType !== 'POINTS') return c;
      const sop = (c.sopTemplateId ? sops.get(c.sopTemplateId) : undefined) ?? byTitle.get(c.name.trim());
      if (!sop || sop.steps.length === 0) return c;
      // The steps keep the form's way of marking them (its first step shows how).
      const first = c.points?.[0];
      const marking: StepMarking = first?.inputType === 'LEVELS' ? { inputType: 'LEVELS', scaleConfig: (first.scaleConfig ?? null) as Record<string, unknown> | null } : PASS_FAIL_MARKING;
      const points = pointsFromSop(sop, marking);
      const name = sop.title.trim().slice(0, MAX_STEP_NAME);
      if (samePoints(c.points ?? [], points) && c.name === name) return c.sopTemplateId === sop.id ? c : { ...c, sopTemplateId: sop.id };
      changed = true;
      return { ...c, name, points, sopTemplateId: sop.id };
    }),
  }));
  return { sections: out, changed };
}

/** The same content, whatever order its keys were written in (missing and undefined count as the same). */
export function sameContent(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => [k, canon((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
