// The appraisal engine's rules — pure functions, the ONE copy (CLAUDE.md:
// shared money / points / permission logic lives in exactly one place).
//  - checkTemplate: weights add up, every criterion is usable
//  - normaliseCriterion: any input → 0–100
//  - scoreAppraisal: weighted total + per-section scores, with the template's missing-criterion policy
//  - canActOnStage: who may assess / sign off / acknowledge, from positions + reports-to

/** POINTS = the average of the criterion's points, each scored its own way. */
/** FORM = a scoring form's weighted total (scaleConfig holds a copy of its sections). */
/** LEVELS = one of a set of named levels, each worth a percentage (e.g. Fail 0, Satisfactory 60, Excellent 100) — or N/A. */
export type InputType = 'RATING' | 'PERCENT' | 'YES_NO' | 'PASS_FAIL' | 'LEVELS' | 'NUMBER' | 'AUTO' | 'POINTS' | 'FORM';

/**
 * Pass / Fail / N/A (PASS_FAIL) — how an SOP step is checked, as in SOP
 * observations: 1 = pass, 0 = fail, -1 = N/A. N/A doesn't count at all — it's
 * left out and the rest share its weight (appraisalRun.logic withoutNotApplicable).
 */
export const NOT_APPLICABLE = -1;
/** Kinds that can be marked N/A (how SOP steps are marked): pass / fail, and named levels. */
export const MARKS_WITH_NA: readonly string[] = ['PASS_FAIL', 'LEVELS'];
export const isNotApplicable = (inputType: string, raw: number | null | undefined) => MARKS_WITH_NA.includes(inputType) && raw === NOT_APPLICABLE;
export type MissingPolicy = 'REQUIRE_ALL' | 'REWEIGHT';

export interface RatingConfig { max: number; levels?: { value: number; label: string; description?: string }[] }
export interface NumberConfig { target: number; higherIsBetter: boolean }
/** Named levels, each worth a percentage; a mark is the level's position (0, 1, …) or N/A. */
export interface LevelsConfig { levels: { label: string; score: number }[] }
/** Bands for AUTO values, checked in order: the first band whose `upTo` the value doesn't exceed gives the score. */
export interface AutoConfig { bands?: { upTo: number; score: number }[] }

export interface CriterionDef {
  id: string;
  name: string;
  weight: number;
  inputType: InputType;
  scaleConfig?: RatingConfig | NumberConfig | AutoConfig | LevelsConfig | null;
  /** Points it's judged on, each scored its own way (normaliseCriterion works on a point too). */
  points?: PointDef[];
}
export interface PointDef { /** Set where an entered score refers to it (a point id, or a copied form item's key). */ id?: string; name: string; inputType: InputType; scaleConfig?: RatingConfig | NumberConfig | AutoConfig | Record<string, unknown> | null }
export interface SectionDef { id: string; name: string; weight: number; criteria: CriterionDef[] }
export interface TemplateDef { sections: SectionDef[]; missingPolicy: MissingPolicy }

const FULL = 100;
const WEIGHT_TOLERANCE = 0.01;
const DEFAULT_RATING_MAX = 5;

const clamp = (n: number) => Math.min(FULL, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** Everything wrong with a template's set-up, in plain words — empty when it can be used. */
export function checkTemplate(t: TemplateDef): string[] {
  const problems: string[] = [];
  if (t.sections.length === 0) problems.push('Add at least one section.');
  const sectionTotal = sum(t.sections.map(s => s.weight));
  if (t.sections.length && Math.abs(sectionTotal - FULL) > WEIGHT_TOLERANCE) {
    problems.push(`Section weights add up to ${round1(sectionTotal)}% — they need to make 100%.`);
  }
  for (const s of t.sections) {
    if (s.weight <= 0) problems.push(`"${s.name}" needs a weight above 0%.`);
    if (s.criteria.length === 0) { problems.push(`"${s.name}" has no criteria.`); continue; }
    const criteriaTotal = sum(s.criteria.map(c => c.weight));
    if (Math.abs(criteriaTotal - FULL) > WEIGHT_TOLERANCE) {
      problems.push(`Criteria in "${s.name}" add up to ${round1(criteriaTotal)}% — they need to make 100%.`);
    }
    for (const c of s.criteria) {
      if (c.weight <= 0) problems.push(`"${c.name}" needs a weight above 0%.`);
      // "On several points" was replaced by scoring forms: an old one is kept (so drafts still save) but can't go live —
      // except an SOP checked step by step (every item pass / fail / N/A), which is how SOP scoring forms are built.
      const sopSteps = !!c.points?.length && c.points.every(p => MARKS_WITH_NA.includes(p.inputType));
      if (c.inputType === 'POINTS' && !sopSteps) problems.push(`"${c.name}" is scored on several points, which is no longer offered — pick how it's scored.`);
      // With points, each point is scored its own way; without, the criterion is.
      const scored = c.points?.length ? c.points : [c];
      for (const p of scored) {
        if (p.inputType === 'NUMBER' && !((p.scaleConfig as NumberConfig | undefined)?.target! > 0)) {
          problems.push(`"${p.name}" needs a target above 0.`);
        }
      }
    }
  }
  return problems;
}

/** One criterion's entered (or auto) value → 0–100. null stays null (not scored yet). */
export function normaliseCriterion(c: Pick<CriterionDef, 'inputType' | 'scaleConfig'>, raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  switch (c.inputType) {
    case 'RATING': {
      // 4 out of 5 = 80.
      const max = (c.scaleConfig as RatingConfig | undefined)?.max ?? DEFAULT_RATING_MAX;
      return clamp((raw / max) * FULL);
    }
    case 'PERCENT':
      return clamp(raw);
    case 'YES_NO':
      return raw > 0 ? FULL : 0;
    case 'PASS_FAIL':
      // N/A has no score — it's left out (see isNotApplicable).
      return raw === NOT_APPLICABLE ? null : raw > 0 ? FULL : 0;
    case 'LEVELS': {
      // The level's own percentage; N/A has none.
      const level = raw === NOT_APPLICABLE ? undefined : (c.scaleConfig as LevelsConfig | undefined)?.levels?.[raw];
      return level ? clamp(level.score) : null;
    }
    case 'NUMBER': {
      const { target, higherIsBetter } = c.scaleConfig as NumberConfig;
      if (higherIsBetter) return clamp((raw / target) * FULL);
      // Lower is better: at or under target = full marks; each target's-worth over loses everything.
      return raw <= target ? FULL : clamp(FULL * (1 - (raw - target) / target));
    }
    case 'POINTS':
    case 'FORM':
      // Scored from its points (combinePoints) / its scoring form's criteria — never entered directly.
      return null;
    case 'AUTO': {
      const bands = (c.scaleConfig as AutoConfig | undefined)?.bands;
      if (!bands?.length) return clamp(raw);
      const band = bands.find(b => raw <= b.upTo) ?? bands[bands.length - 1];
      return clamp(band.score);
    }
  }
}

/**
 * A criterion that has points (e.g. "Love and patience" → "Speaks calmly", …):
 * its 0–100 score is the plain average of its points' 0–100 scores. With
 * REQUIRE_ALL every point must be scored first; with REWEIGHT unscored points
 * drop out. null = not scored yet.
 */
export function combinePoints(pointScores: (number | null | undefined)[], policy: MissingPolicy): number | null {
  const scored = pointScores.filter((s): s is number => s != null && !Number.isNaN(s));
  if (scored.length === 0) return null;
  if (policy === 'REQUIRE_ALL' && scored.length < pointScores.length) return null;
  return sum(scored) / scored.length;
}

export interface AppraisalResult {
  /** Weighted 0–100 total (1 decimal), or null if it can't be worked out yet. */
  total: number | null;
  bySection: { sectionId: string; score: number | null }[];
  /** Criteria with no score yet. */
  missing: string[];
  /** All required criteria scored, so it can be submitted. */
  complete: boolean;
}

/**
 * The appraisal total from its criteria's 0–100 scores (by criterion id).
 * REQUIRE_ALL: nothing missing, or no total. REWEIGHT: missing criteria (and
 * empty sections) drop out and the rest share their weight. Rounded once, at the end.
 */
export function scoreAppraisal(t: TemplateDef, scores: Record<string, number | null | undefined>): AppraisalResult {
  const missing = t.sections.flatMap(s => s.criteria.filter(c => scores[c.id] == null).map(c => c.id));
  const bySectionRaw = t.sections.map(s => {
    const present = s.criteria.filter(c => scores[c.id] != null);
    const w = sum(present.map(c => c.weight));
    return { sectionId: s.id, weight: s.weight, score: w > 0 ? sum(present.map(c => (scores[c.id] as number) * c.weight)) / w : null };
  });
  const bySection = bySectionRaw.map(s => ({ sectionId: s.sectionId, score: s.score == null ? null : round1(s.score) }));

  if (t.missingPolicy === 'REQUIRE_ALL' && missing.length > 0) {
    return { total: null, bySection, missing, complete: false };
  }
  const scored = bySectionRaw.filter(s => s.score != null);
  const totalWeight = sum(scored.map(s => s.weight));
  const total = totalWeight > 0 ? round1(sum(scored.map(s => (s.score as number) * s.weight)) / totalWeight) : null;
  return { total, bySection, missing, complete: total != null && (t.missingPolicy === 'REWEIGHT' || missing.length === 0) };
}

// ── Who may act on a stage ───────────────────────────────────────────────────

export type StageKind = 'ASSESS' | 'SIGN_OFF' | 'ACKNOWLEDGE';
export interface StageDef { kind: StageKind; scope: 'ANYONE' | 'OWN_TEAM'; positionIds: string[] }
export interface Actor { teacherId: string | null; positionId: string | null; isAdmin: boolean }

/**
 * May this person act on this stage of this staff member's appraisal?
 * Acknowledge: only the staff member. Assess / sign off: admins, or someone
 * holding one of the stage's positions — for OWN_TEAM, only if they're in the
 * staff member's reports-to chain. Never your own appraisal.
 * `managerChain` = the staff member's manager, their manager, … (teacher ids).
 */
export function canActOnStage(stage: StageDef, actor: Actor, staffTeacherId: string, managerChain: string[]): boolean {
  if (stage.kind === 'ACKNOWLEDGE') return actor.teacherId === staffTeacherId;
  if (actor.teacherId === staffTeacherId) return false;
  if (actor.isAdmin) return true;
  if (!actor.positionId || !stage.positionIds.includes(actor.positionId)) return false;
  return stage.scope === 'ANYONE' || (!!actor.teacherId && managerChain.includes(actor.teacherId));
}

/**
 * Everything wrong with a template's approval chain, in plain words.
 * The shape is fixed: one Assess step first, then any number of sign-offs,
 * then (optionally) the staff member acknowledges last. Every step except
 * acknowledging needs at least one position to do it.
 */
export function checkStages(stages: (StageDef & { name: string })[]): string[] {
  const problems: string[] = [];
  const assess = stages.filter(s => s.kind === 'ASSESS');
  if (assess.length !== 1 || stages[0]?.kind !== 'ASSESS') problems.push('Start with exactly one "Assessed by" step.');
  const ackAt = stages.findIndex(s => s.kind === 'ACKNOWLEDGE');
  if (ackAt !== -1 && ackAt !== stages.length - 1) problems.push('Acknowledging has to be the last step.');
  if (stages.filter(s => s.kind === 'ACKNOWLEDGE').length > 1) problems.push('Only one acknowledge step is allowed.');
  for (const s of stages) {
    if (s.kind !== 'ACKNOWLEDGE' && s.positionIds.length === 0) {
      problems.push(`"${s.name || 'A step'}" needs at least one position to do it.`);
    }
  }
  // One person scores each appraisal, so marks never clash.
  if (assess.some(s => s.positionIds.length > 1)) problems.push('Only one position can score it — pick one.');
  return problems;
}

/** The staff member's managers, nearest first, from a reports-to map — stops on a loop. */
/** Everyone who reports to this person — directly, or further down the line (never themselves). */
export function teamOf(teacherId: string, reportsTo: Map<string, string | null>): Set<string> {
  const team = new Set<string>();
  for (const id of reportsTo.keys()) {
    if (id !== teacherId && managerChainOf(id, reportsTo).includes(teacherId)) team.add(id);
  }
  return team;
}

export function managerChainOf(teacherId: string, reportsTo: Map<string, string | null>): string[] {
  const chain: string[] = [];
  const seen = new Set([teacherId]);
  let next = reportsTo.get(teacherId) ?? null;
  while (next && !seen.has(next)) {
    chain.push(next);
    seen.add(next);
    next = reportsTo.get(next) ?? null;
  }
  return chain;
}
