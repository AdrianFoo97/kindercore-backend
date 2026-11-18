// The appraisal workflow's rules — pure functions, tested on their own
// (appraisalRun.logic.test.ts). The service (appraisalRuns.service) only loads,
// checks who may act, and saves.
//
//  - periodOf / isDue: which period an appraisal belongs to, and whether one is due
//  - rawValueProblem: is an entered value allowed for this kind of criterion
//  - criterionScores: each criterion's 0–100 score from what was entered —
//    directly, from its points (their average), or from a copied scoring form
//    (its weighted total)
//  - stepAfter: where an appraisal goes next in its approval chain

import {
  NOT_APPLICABLE, combinePoints, isNotApplicable, normaliseCriterion, scoreAppraisal,
  type InputType, type MissingPolicy, type NumberConfig, type RatingConfig, type SectionDef, type TemplateDef,
} from './appraisalScoring.service.js';

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MANUAL';
export interface Period { year: number; month: number }

const MONTHS_PER_QUARTER = 3;
const DEFAULT_RATING_MAX = 5;

/** The period a month falls in: the month itself, its quarter's first month, or January. */
export function periodOf(frequency: Frequency, year: number, month: number): Period {
  if (frequency === 'QUARTERLY') return { year, month: Math.floor(month / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER };
  if (frequency === 'YEARLY') return { year, month: 0 };
  return { year, month };
}

/** Is an appraisal due in this month? "When needed" forms never are — they're started by hand. */
export function isDue(frequency: Frequency, month: number): boolean {
  if (frequency === 'MANUAL') return false;
  if (frequency === 'QUARTERLY') return month % MONTHS_PER_QUARTER === 0;
  if (frequency === 'YEARLY') return month === 0;
  return true;
}

/** Why an entered value isn't allowed for this kind of criterion, or null if it's fine. */
export function rawValueProblem(def: { name: string; inputType: InputType; scaleConfig?: unknown }, raw: number): string | null {
  if (!Number.isFinite(raw)) return `"${def.name}" needs a number.`;
  switch (def.inputType) {
    case 'RATING': {
      const max = (def.scaleConfig as RatingConfig | null)?.max ?? DEFAULT_RATING_MAX;
      return Number.isInteger(raw) && raw >= 1 && raw <= max ? null : `"${def.name}" is rated 1 to ${max}.`;
    }
    case 'PERCENT': return raw >= 0 && raw <= 100 ? null : `"${def.name}" is a percentage, 0 to 100.`;
    case 'YES_NO': return raw === 0 || raw === 1 ? null : `"${def.name}" is yes or no.`;
    case 'PASS_FAIL': return raw === 0 || raw === 1 || raw === NOT_APPLICABLE ? null : `"${def.name}" is pass, fail or N/A.`;
    case 'LEVELS': {
      const count = (def.scaleConfig as { levels?: unknown[] } | null)?.levels?.length ?? 0;
      return raw === NOT_APPLICABLE || (Number.isInteger(raw) && raw >= 0 && raw < count) ? null : `"${def.name}" needs one of its levels, or N/A.`;
    }
    case 'NUMBER': return raw >= 0 ? null : `"${def.name}" can't be below 0.`;
    default: return `"${def.name}" isn't scored directly.`;
  }
}

/** What's entered: per criterion, per point (by point id), or per scoring-form criterion (by formKey). */
export interface EnteredScore { criterionId: string; pointId: string | null; rawValue: number | null }

/** A scoring-form criterion's key within the copy: section and criterion position, e.g. "f:0:2". */
export const formKey = (sectionIndex: number, criterionIndex: number) => `f:${sectionIndex}:${criterionIndex}`;
/** One item of a scoring-form criterion scored on its items (e.g. an SOP's step), e.g. "f:0:2:4". */
export const formItemKey = (sectionIndex: number, criterionIndex: number, itemIndex: number) => `${formKey(sectionIndex, criterionIndex)}:${itemIndex}`;

/** The copied scoring form inside a FORM criterion, as a template to score — its criteria keyed by formKey. */
export function formCopyAsTemplate(scaleConfig: unknown, missingPolicy: MissingPolicy): TemplateDef {
  const sections = ((scaleConfig as { sections?: unknown[] } | null)?.sections ?? []) as {
    name: string; weight: number; criteria: { name: string; weight: number; inputType: InputType; scaleConfig?: unknown; points?: { name: string; inputType?: InputType; scaleConfig?: unknown }[] }[];
  }[];
  return {
    missingPolicy,
    sections: sections.map((s, si): SectionDef => ({
      id: `fs:${si}`, name: s.name, weight: s.weight,
      criteria: s.criteria.map((c, ci) => ({
        id: formKey(si, ci), name: c.name, weight: c.weight, inputType: c.inputType,
        scaleConfig: (c.scaleConfig ?? null) as RatingConfig | NumberConfig | null,
        // Scored on its items (e.g. an SOP's steps): each item keyed formItemKey.
        ...(c.points?.length ? { points: c.points.map((p, pi) => ({ id: formItemKey(si, ci, pi), name: p.name, inputType: (p.inputType ?? 'RATING') as InputType, scaleConfig: (p.scaleConfig ?? null) as RatingConfig | NumberConfig | null })) } : {}),
      })),
    })),
  };
}

/** A criterion with what's needed to score it (point ids for "on several points"). */
export interface ScorableCriterion {
  id: string; name: string; weight: number; inputType: InputType; scaleConfig?: unknown;
  points?: { id: string; name: string; inputType: InputType; scaleConfig?: unknown }[];
}
export interface ScorableTemplate { missingPolicy: MissingPolicy; sections: { id: string; name: string; weight: number; criteria: ScorableCriterion[] }[] }

/** The template without what's N/A, and without the sections that leaves empty — N/A never counts. */
export function withoutNotApplicable<T extends { sections: { criteria: { id: string }[] }[] }>(t: T, na: Set<string>): T {
  return { ...t, sections: t.sections.map(s => ({ ...s, criteria: s.criteria.filter(c => !na.has(c.id)) })).filter(s => s.criteria.length > 0) };
}

/**
 * Each criterion's 0–100 score from what was entered (null = not scored yet),
 * and which criteria are N/A. Steps marked N/A (Pass / Fail / N/A) are left out
 * and the rest share their weight; a criterion whose every part is N/A is
 * itself N/A.
 */
export function scoreCriteria(t: ScorableTemplate, entered: EnteredScore[]): { scores: Record<string, number | null>; notApplicable: Set<string> } {
  const raw = (criterionId: string, pointId: string | null) =>
    entered.find(e => e.criterionId === criterionId && (e.pointId ?? null) === pointId)?.rawValue ?? null;
  const scores: Record<string, number | null> = {};
  const notApplicable = new Set<string>();
  for (const c of t.sections.flatMap(s => s.criteria)) {
    if (c.inputType === 'FORM') {
      const form = formCopyAsTemplate(c.scaleConfig, t.missingPolicy);
      const sub: Record<string, number | null> = {};
      const subNA = new Set<string>();
      for (const fc of form.sections.flatMap(s => s.criteria)) {
        if (fc.points?.length) {
          // Scored on its items (e.g. an SOP's steps): their average, N/A left out — passed ÷ decided for pass / fail.
          const items = fc.points.map(p => ({ p, r: raw(c.id, p.id) }));
          const counted = items.filter(x => !isNotApplicable(x.p.inputType, x.r));
          if (counted.length === 0) subNA.add(fc.id);
          else sub[fc.id] = combinePoints(counted.map(x => normaliseCriterion(x.p as never, x.r)), t.missingPolicy);
          continue;
        }
        const r = raw(c.id, fc.id);
        if (isNotApplicable(fc.inputType, r)) subNA.add(fc.id);
        else sub[fc.id] = normaliseCriterion(fc, r);
      }
      const counted = withoutNotApplicable(form, subNA);
      if (subNA.size > 0 && counted.sections.length === 0) { notApplicable.add(c.id); scores[c.id] = null; }
      else scores[c.id] = scoreAppraisal(counted, sub).total;
    } else if (c.inputType === 'POINTS' || (c.points?.length ?? 0) > 0) {
      const points = (c.points ?? []).map(p => ({ p, r: raw(c.id, p.id) }));
      const counted = points.filter(x => !isNotApplicable(x.p.inputType, x.r));
      if (points.length > 0 && counted.length === 0) { notApplicable.add(c.id); scores[c.id] = null; }
      else scores[c.id] = combinePoints(counted.map(x => normaliseCriterion(x.p as never, x.r)), t.missingPolicy);
    } else {
      const r = raw(c.id, null);
      if (isNotApplicable(c.inputType, r)) { notApplicable.add(c.id); scores[c.id] = null; }
      else scores[c.id] = normaliseCriterion(c as never, r);
    }
  }
  return { scores, notApplicable };
}

/** Each criterion's 0–100 score from what was entered (null = not scored yet, or N/A). */
export const criterionScores = (t: ScorableTemplate, entered: EnteredScore[]) => scoreCriteria(t, entered).scores;

/** The whole appraisal: each criterion's score, then the weighted total (N/A criteria left out). */
export function scoreRun(t: ScorableTemplate, entered: EnteredScore[]) {
  const { scores: byCriterion, notApplicable } = scoreCriteria(t, entered);
  // scoreAppraisal only reads ids and weights — the criteria's own scoring is already in byCriterion.
  return { byCriterion, ...scoreAppraisal(withoutNotApplicable(t, notApplicable) as unknown as TemplateDef, byCriterion) };
}

export type StepKind = 'ASSESS' | 'SIGN_OFF' | 'ACKNOWLEDGE';
export type RunStatus = 'IN_PROGRESS' | 'SENT_BACK' | 'AWAITING_SIGN_OFF' | 'AWAITING_ACKNOWLEDGEMENT' | 'COMPLETED';

/** Where the appraisal goes after the step at `order` is done: the next step, or completed. */
export function stepAfter(steps: { kind: StepKind; sortOrder: number }[], order: number): { status: RunStatus; order: number | null } {
  const next = [...steps].sort((a, b) => a.sortOrder - b.sortOrder).find(s => s.sortOrder > order);
  if (!next) return { status: 'COMPLETED', order: null };
  return { status: next.kind === 'ACKNOWLEDGE' ? 'AWAITING_ACKNOWLEDGEMENT' : 'AWAITING_SIGN_OFF', order: next.sortOrder };
}

/**
 * Whoever scored an appraisal may sign it off too only from the top of the reporting
 * line — with no one above them, there's no one else to. Anyone else's scoring is
 * signed off by someone further up. (Nobody acts on their own appraisal at all — canActOnStage.)
 */
export function scorerMaySignOff(scoredIt: boolean, atTopOfReportingLine: boolean): boolean {
  return !scoredIt || atTopOfReportingLine;
}

/** Decimal places kept on a month's score made from more than one appraisal. */
const MONTH_SCORE_DECIMALS = 1;

/**
 * A month's score from its completed form appraisals: usually just the one; with a second
 * (started after the warning) it's their average. Falls back to this one's total.
 */
export function monthScoreOf(completedTotals: number[], thisTotal: number): number {
  if (completedTotals.length <= 1) return completedTotals[0] ?? thisTotal;
  const f = 10 ** MONTH_SCORE_DECIMALS;
  return Math.round((completedTotals.reduce((a, b) => a + b, 0) / completedTotals.length) * f) / f;
}
