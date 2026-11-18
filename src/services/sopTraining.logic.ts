// Teacher app → My training: the trainer records that they gave the training.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** What's wrong with the day the training was given (YYYY-MM-DD), compared with today in Malaysia — or null. */
export function trainedOnProblem(trainedOn: string, today: string): string | null {
  if (!DAY_PATTERN.test(trainedOn) || Number.isNaN(Date.parse(`${trainedOn}T00:00:00Z`))) return 'Pick the day the training was given.';
  if (trainedOn > today) return 'The training day can’t be in the future.';
  return null;
}

export type StepMark = 'PASS' | 'FAIL' | 'NA';

/**
 * Why the assessor can't certify yet — or null. Certified means every step they
 * checked was done right: a failed step goes back for more training instead, and
 * all N/A means nothing was actually assessed.
 */
export function certifyProblem(marks: StepMark[]): string | null {
  if (marks.some(m => m === 'FAIL')) return 'A step failed — send it back for more training instead of certifying.';
  if (!marks.some(m => m === 'PASS')) return 'Mark at least one step passed before certifying.';
  return null;
}

// ── How practice observations mark steps (Settings → Practice observations) ──
// Pass / Fail / N/A, or levels each worth a percentage with a pass mark — a step
// at or above the pass mark passes, below it fails (and fails certification).
// Each observation keeps the marking it was assigned with.

export const OBSERVATION_MARKING_KEY = 'observation_step_marking';
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;
const MAX_LEVEL_LABEL = 40;

export interface MarkLevel { label: string; score: number }
export type ObservationMarking = { inputType: 'PASS_FAIL' } | { inputType: 'LEVELS'; levels: MarkLevel[]; passMark: number; source?: unknown };
export const PASS_FAIL_MARKING: ObservationMarking = { inputType: 'PASS_FAIL' };

/** The saved setting (or an observation's copy) → a usable marking; anything incomplete is pass / fail. */
export function observationMarkingFrom(raw: unknown): ObservationMarking {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!v || typeof v !== 'object' || (v as { inputType?: string }).inputType !== 'LEVELS') return PASS_FAIL_MARKING;
  const { levels, passMark, source } = v as { levels?: unknown; passMark?: unknown; source?: unknown };
  if (!Array.isArray(levels) || levels.length < MIN_LEVELS || levels.length > MAX_LEVELS) return PASS_FAIL_MARKING;
  const clean = levels.map(l => ({ label: String((l as MarkLevel)?.label ?? '').trim().slice(0, MAX_LEVEL_LABEL), score: Number((l as MarkLevel)?.score) }));
  if (clean.some(l => !l.label || !Number.isFinite(l.score) || l.score < 0 || l.score > 100)) return PASS_FAIL_MARKING;
  const mark = Number(passMark);
  return { inputType: 'LEVELS', levels: clean, passMark: Number.isFinite(mark) ? mark : Math.min(...clean.filter(l => l.score > 0).map(l => l.score), 100), ...(source ? { source } : {}) };
}

/** One step's mark as entered: pass / fail / N/A, or a level's position (-1 or none = N/A). */
export interface EnteredMark { stepId: string; passed?: StepMark; level?: number | null; note?: string | null }
export interface StoredMark { stepId: string; passed: StepMark; level: number | null; note: string | null }

/** What's stored for each step under this marking — a level becomes pass or fail against the pass mark — or why it can't be. */
export function storedMarks(m: ObservationMarking, entered: EnteredMark[]): { marks: StoredMark[] } | { problem: string } {
  const marks: StoredMark[] = [];
  for (const e of entered) {
    if (m.inputType === 'PASS_FAIL') {
      if (!e.passed) return { problem: 'Mark each step pass, fail or N/A.' };
      marks.push({ stepId: e.stepId, passed: e.passed, level: null, note: e.note ?? null });
      continue;
    }
    if (e.level == null || e.level === -1) { marks.push({ stepId: e.stepId, passed: 'NA', level: null, note: e.note ?? null }); continue; }
    const level = m.levels[e.level];
    if (!Number.isInteger(e.level) || !level) return { problem: 'A step’s level isn’t one of this observation’s levels.' };
    marks.push({ stepId: e.stepId, passed: level.score >= m.passMark ? 'PASS' : 'FAIL', level: e.level, note: e.note ?? null });
  }
  return { marks };
}
