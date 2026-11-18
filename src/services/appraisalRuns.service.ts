import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  appraisalLogs, appraisalScores, appraisalTemplates, appraisals, teacherAppraisals, teachers, users,
} from '../db/schema.js';
import { canActOnStage, managerChainOf } from './appraisalScoring.service.js';
import { inStaffScope, staffScopeFor, type StaffScope } from './performanceScope.service.js';
import { loadTemplate, type TemplateDetail } from './appraisalTemplates.service.js';
import { keepSopsCurrent } from './sopRefresh.service.js';
import {
  monthScoreOf, rawValueProblem, scoreRun, scorerMaySignOff, stepAfter, formCopyAsTemplate,
  type EnteredScore, type RunStatus, type ScorableTemplate, type StepKind,
} from './appraisalRun.logic.js';

// Appraising staff with a form: an appraisal is created for a period by the
// appraisal schedule (appraisalSchedules.service), then scored (saved as a
// draft until submitted), signed off (or sent back), and confirmed by the
// staff member.
// Every step is logged. A completed appraisal also writes its total into the
// monthly score (TeacherAppraisal) that drives the 12-month average and the
// promotion gate. The rules are pure, in appraisalRun.logic.

export interface Actor {
  userId: string;
  name: string;
  teacherId: string | null;
  positionId: string | null;
  isAdmin: boolean;
  /** Has the HR module — can see and cancel appraisals of the staff in their scope. */
  isHr: boolean;
  /** Whose appraisals HR access covers: everyone, or their team (performanceScope). */
  scope: StaffScope;
}

type Run = typeof appraisals.$inferSelect;
/** A refusal: its status and reason — and, when it's because one already exists, which one. */
type Fail = { error: string; status: number; existingId?: string };
const fail = (status: number, error: string): Fail => ({ error, status });
const NOT_YOURS = fail(403, 'This appraisal isn’t yours to see.');

/** Who's asking, as the workflow needs to know them. */
export async function actorFor(user: { id: string; role: string; teacherId?: string | null }, isHr: boolean): Promise<Actor> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id));
  const [t] = user.teacherId ? await db.select({ positionId: teachers.positionId }).from(teachers).where(eq(teachers.id, user.teacherId)) : [];
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  const scope = await staffScopeFor({ id: user.id, role: user.role, teacherId: user.teacherId ?? null });
  return { userId: user.id, name: u?.name ?? 'Someone', teacherId: user.teacherId ?? null, positionId: t?.positionId ?? null, isAdmin, isHr: isHr || isAdmin, scope };
}

/** Who reports to whom, for the staff member's manager chain and whether the asker is at the top (reports to no one). */
interface ReportingLines { reportsTo: Map<string, string | null> }
async function reportingLines(): Promise<ReportingLines> {
  const rows = await db.select({ id: teachers.id, reportsTo: teachers.reportsToTeacherId }).from(teachers);
  return { reportsTo: new Map(rows.map(r => [r.id, r.reportsTo ?? null])) };
}
/** At the top of the reporting line: no one above them (or no staff record — e.g. an admin account). */
const atTop = (actor: Actor, lines: ReportingLines) => !actor.teacherId || !lines.reportsTo.get(actor.teacherId);

/** Who a log line is by: a person, or the schedule (no user). */
export interface LogAuthor { userId: string | null; name: string }

const log = (appraisalId: string, kind: string, actor: LogAuthor, detail: string | null = null) =>
  db.insert(appraisalLogs).values({ id: randomUUID(), appraisalId, kind, detail, authorUserId: actor.userId, authorName: actor.name, createdAt: new Date() });

// ── Creating one ─────────────────────────────────────────────────────────────

export async function liveVersionOf(familyId: string) {
  const [live] = await db.select().from(appraisalTemplates)
    .where(and(eq(appraisalTemplates.familyId, familyId), eq(appraisalTemplates.status, 'ACTIVE')));
  return live ?? null;
}

/** Who started it when nobody pressed a button — the appraisal schedule. */
export const SCHEDULER: LogAuthor = { userId: null, name: 'Appraisal schedule' };

/**
 * Create an appraisal for a staff member on a form's live version, for a
 * period — by the appraisal schedule (or HR pressing "Create now" on one).
 * It starts pending: nothing scored yet. One per staff member, form and period.
 */
export async function createRun(
  teacherId: string, familyId: string, periodType: string, period: { year: number; month: number }, author: LogAuthor,
  /** A second appraisal this month on another form: schedules make it (set up on purpose); by hand it needs the go-ahead after the warning. */
  secondInMonth: 'allow' | 'warn' = 'allow',
): Promise<{ id: string } | Fail> {
  const [t] = await db.select({ id: teachers.id, name: teachers.name }).from(teachers).where(eq(teachers.id, teacherId));
  if (!t) return fail(404, 'Staff member not found');
  // An SOP edited since the form copied it: new appraisals use its current steps (a new form version);
  // ones already created keep theirs. Never blocks creating the appraisal.
  await keepSopsCurrent(familyId).catch(e => console.warn('[appraisals] Keeping SOP steps current failed:', e?.message ?? e));
  const form = await liveVersionOf(familyId);
  if (!form) return fail(400, 'Its appraisal form isn’t live — make it live first.');
  const versions = await db.select({ id: appraisalTemplates.id }).from(appraisalTemplates).where(eq(appraisalTemplates.familyId, familyId));
  const [existing] = await db.select({ id: appraisals.id }).from(appraisals).where(and(
    eq(appraisals.teacherId, teacherId), inArray(appraisals.templateId, versions.map(v => v.id)),
    eq(appraisals.periodYear, period.year), eq(appraisals.periodMonth, period.month),
  ));
  // Says which one, so the screen can open it rather than leave people looking for it.
  if (existing) return { ...fail(409, `${t.name} already has a ${form.name} appraisal for ${MONTH_NAMES[period.month]} ${period.year}.`), existingId: existing.id };
  // Usually one appraisal per month. A second (another form) is allowed once they've been warned —
  // the month's score is then the average of them (complete). Months from before forms don't count.
  const other = secondInMonth === 'warn' ? await otherAppraisalFor(teacherId, period) : null;
  if (other) return fail(409, `${other.staffName} already has an appraisal for ${MONTH_NAMES[period.month]} ${period.year} (${other.formName}). Start a second one anyway? The month’s score will be the average of the two.`);
  const template = await loadTemplate(form.id);
  const assess = template?.stages.find(s => s.kind === 'ASSESS');
  const id = randomUUID();
  const now = new Date();
  await db.insert(appraisals).values({
    id, teacherId, templateId: form.id, periodYear: period.year, periodMonth: period.month, periodType, status: 'IN_PROGRESS',
    currentStageOrder: assess ? stageOrder(template!, assess.id) : 0, createdAt: now, updatedAt: now,
  });
  await log(id, 'STARTED', author);
  return { id };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** An appraisal this staff member already has for the month, on any form (not the carried-over legacy ones). */
async function otherAppraisalFor(teacherId: string, period: { year: number; month: number }) {
  const [row] = await db.select({ formName: appraisalTemplates.name, staffName: teachers.name })
    .from(appraisals)
    .innerJoin(appraisalTemplates, eq(appraisalTemplates.id, appraisals.templateId))
    .innerJoin(teachers, eq(teachers.id, appraisals.teacherId))
    .where(and(eq(appraisals.teacherId, teacherId), eq(appraisals.periodYear, period.year), eq(appraisals.periodMonth, period.month), eq(appraisalTemplates.isLegacy, false)));
  return row ?? null;
}

// ── Reading one ──────────────────────────────────────────────────────────────

const stageOrder = (t: TemplateDetail, stageId: string) => t.stages.findIndex(s => s.id === stageId);
const steps = (t: TemplateDetail) => t.stages.map((s, i) => ({ kind: s.kind as StepKind, sortOrder: i }));

/** What this person may do with this appraisal right now. */
function permissions(run: Run, t: TemplateDetail, actor: Actor, lines: ReportingLines) {
  const chain = managerChainOf(run.teacherId, lines.reportsTo);
  const scoredIt = !!run.assessedByUserId && run.assessedByUserId === actor.userId;
  const current = run.currentStageOrder == null ? null : t.stages[run.currentStageOrder] ?? null;
  const onCurrent = !!current && canActOnStage(current, actor, run.teacherId, chain);
  const scoring = run.status === 'IN_PROGRESS' || run.status === 'SENT_BACK';
  const isStaff = actor.teacherId === run.teacherId;
  // HR for staff in their scope, or anyone on the chain, may look; the staff member only once it's been signed off.
  const hrHere = actor.isHr && inStaffScope(actor.scope, run.teacherId);
  const onChain = t.stages.some(s => s.kind !== 'ACKNOWLEDGE' && canActOnStage(s, actor, run.teacherId, chain));
  const view = hrHere || onChain || (isStaff && (run.status === 'AWAITING_ACKNOWLEDGEMENT' || run.status === 'COMPLETED'));
  return {
    view,
    score: scoring && onCurrent,
    signOff: run.status === 'AWAITING_SIGN_OFF' && onCurrent && scorerMaySignOff(scoredIt, atTop(actor, lines)),
    /** On this sign-off step but scored it themselves, with someone above them — that person signs it off. */
    scoredSoSomeoneAboveSignsOff: run.status === 'AWAITING_SIGN_OFF' && onCurrent && !scorerMaySignOff(scoredIt, atTop(actor, lines)),
    acknowledge: run.status === 'AWAITING_ACKNOWLEDGEMENT' && isStaff,
    cancel: hrHere && run.status !== 'COMPLETED',
  };
}

async function loadRunParts(id: string, actor: Actor) {
  const [run] = await db.select().from(appraisals).where(eq(appraisals.id, id));
  // Unknown and not-yours look the same to anyone outside HR.
  if (!run) return actor.isHr && actor.scope.all ? fail(404, 'Appraisal not found') : NOT_YOURS;
  const template = await loadTemplate(run.templateId);
  if (!template) return fail(404, 'Its appraisal form can’t be found');
  const can = permissions(run, template, actor, await reportingLines());
  if (!can.view) return NOT_YOURS;
  return { run, template, can, mine: actor.teacherId === run.teacherId };
}

const scorable = (t: TemplateDetail): ScorableTemplate => ({
  missingPolicy: t.missingPolicy,
  sections: t.sections.map(s => ({
    id: s.id, name: s.name, weight: s.weight,
    criteria: s.criteria.map(c => ({ id: c.id, name: c.name, weight: c.weight, inputType: c.inputType, scaleConfig: c.scaleConfig, points: c.points })),
  })),
});

/** One appraisal in full: the exact form version it's scored on, what's entered, the working total, the log. */
export async function runDetail(id: string, actor: Actor) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  const { run, template, can, mine } = parts;
  const [staff] = await db.select({ name: teachers.name }).from(teachers).where(eq(teachers.id, run.teacherId));
  const scores = await db.select().from(appraisalScores).where(eq(appraisalScores.appraisalId, id));
  const logs = await db.select().from(appraisalLogs).where(eq(appraisalLogs.appraisalId, id)).orderBy(asc(appraisalLogs.createdAt));
  const working = scoreRun(scorable(template), scores);
  return {
    id: run.id, teacherId: run.teacherId, teacherName: staff?.name ?? 'Staff member',
    period: { year: run.periodYear, month: run.periodMonth }, periodType: run.periodType ?? 'MONTHLY', status: run.status, currentStep: run.currentStageOrder,
    totalScore: run.totalScore, workingTotal: working.total, byCriterion: working.byCriterion, missing: working.missing,
    comments: run.comments, assessedByName: run.assessedByName, completedAt: run.completedAt,
    form: { id: template.id, familyId: template.familyId, name: template.name, version: template.version, missingPolicy: template.missingPolicy, sections: template.sections, stages: template.stages },
    scores: scores.map(s => ({ criterionId: s.criterionId, pointId: s.pointId, rawValue: s.rawValue, normalised: s.normalised, comment: s.comment })),
    log: logs.map(l => ({ kind: l.kind, detail: l.detail, authorName: l.authorName, at: l.createdAt })),
    can: { score: can.score, signOff: can.signOff, acknowledge: can.acknowledge, cancel: can.cancel },
    /** They're on the sign-off step but scored it — it waits for someone above them. */
    signOffBySomeoneAbove: can.scoredSoSomeoneAboveSignsOff,
    /** It's the asker's own appraisal (they're the staff member) — not one they score or sign off. */
    mine,
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoreInput { criterionId: string; pointId?: string | null; rawValue: number | null; comment?: string | null }

/** Check each entered score against the form version: a criterion (or point / scoring-form criterion) of it, with an allowed value. */
function enteredProblems(t: TemplateDetail, entries: ScoreInput[]): string | null {
  for (const e of entries) {
    const c = t.sections.flatMap(s => s.criteria).find(x => x.id === e.criterionId);
    if (!c) return 'A score is for a criterion that isn’t on this form.';
    let target: { name: string; inputType: string; scaleConfig?: unknown } | undefined = c;
    if (c.inputType === 'FORM') {
      // A copied scoring form's criterion, or one of its items (e.g. an SOP step).
      const formCriteria = formCopyAsTemplate(c.scaleConfig, t.missingPolicy).sections.flatMap(s => s.criteria);
      target = formCriteria.find(x => x.id === e.pointId && !x.points?.length) ?? formCriteria.flatMap(x => x.points ?? []).find(x => x.id === e.pointId);
    }
    else if (c.points?.length) target = c.points.find(p => p.id === e.pointId);
    else if (e.pointId) target = undefined;
    if (!target) return `A score for "${c.name}" doesn’t match the form.`;
    if (e.rawValue != null) {
      const problem = rawValueProblem(target as never, e.rawValue);
      if (problem) return problem;
    }
  }
  return null;
}

/** Save what the scorer has entered so far (and their overall comments). Only while it's being scored, by the scorer. */
export async function saveScores(id: string, actor: Actor, entries: ScoreInput[], comments: string | null) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (!parts.can.score) return fail(403, 'Only the person scoring it can change the scores, while it’s being scored.');
  const problem = enteredProblems(parts.template, entries);
  if (problem) return fail(400, problem);
  await db.transaction(async tx => {
    await tx.delete(appraisalScores).where(eq(appraisalScores.appraisalId, id));
    const rows = entries.filter(e => e.rawValue != null || e.comment);
    if (rows.length) {
      await tx.insert(appraisalScores).values(rows.map(e => ({
        id: randomUUID(), appraisalId: id, criterionId: e.criterionId, pointId: e.pointId ?? null, rawValue: e.rawValue, comment: e.comment || null,
      })));
    }
    await tx.update(appraisals).set({ comments, updatedAt: new Date() }).where(eq(appraisals.id, id));
  });
  return runDetail(id, actor);
}

/** Submit the scores: the total is worked out and it moves to sign-off (or on). Everything required must be scored. */
export async function submitRun(id: string, actor: Actor) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (!parts.can.score) return fail(403, 'Only the person scoring it can submit it, while it’s being scored.');
  const { run, template } = parts;
  const entered = await db.select().from(appraisalScores).where(eq(appraisalScores.appraisalId, id));
  const result = scoreRun(scorable(template), entered);
  if (!result.complete || result.total == null) {
    const names = template.sections.flatMap(s => s.criteria).filter(c => result.missing.includes(c.id)).map(c => c.name);
    return fail(400, `Score everything first — still to do: ${names.join(', ')}.`);
  }
  const next = stepAfter(steps(template), run.currentStageOrder ?? 0);
  await db.transaction(async tx => {
    for (const e of entered) {
      if (e.pointId == null) await tx.update(appraisalScores).set({ normalised: result.byCriterion[e.criterionId] }).where(eq(appraisalScores.id, e.id));
    }
    await tx.update(appraisals).set({
      totalScore: result.total, assessedByUserId: actor.userId, assessedByName: actor.name,
      status: next.status, currentStageOrder: next.order, updatedAt: new Date(),
    }).where(eq(appraisals.id, id));
  });
  await log(id, 'SUBMITTED', actor, `Total ${result.total}%`);
  if (next.status === 'COMPLETED') await complete(id);
  return runDetail(id, actor);
}

/** Sign it off: on to the next step (or done). Only someone on the current sign-off step. */
export async function approveRun(id: string, actor: Actor) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (parts.can.scoredSoSomeoneAboveSignsOff) return fail(403, 'You scored this one, so someone above you in the reporting line signs it off.');
  if (!parts.can.signOff) return fail(403, 'Only someone on this sign-off step can approve it.');
  const next = stepAfter(steps(parts.template), parts.run.currentStageOrder ?? 0);
  await db.update(appraisals).set({ status: next.status, currentStageOrder: next.order, updatedAt: new Date() }).where(eq(appraisals.id, id));
  await log(id, 'SIGNED_OFF', actor);
  if (next.status === 'COMPLETED') await complete(id);
  return runDetail(id, actor);
}

/** Send it back to whoever scored it, saying why. */
export async function sendBackRun(id: string, actor: Actor, reason: string) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (!parts.can.signOff) return fail(403, 'Only someone on this sign-off step can send it back.');
  const assess = parts.template.stages.findIndex(s => s.kind === 'ASSESS');
  await db.update(appraisals).set({ status: 'SENT_BACK', currentStageOrder: Math.max(0, assess), updatedAt: new Date() }).where(eq(appraisals.id, id));
  await log(id, 'SENT_BACK', actor, reason);
  return runDetail(id, actor);
}

/** The staff member confirms they've read it — it's done. */
export async function acknowledgeRun(id: string, actor: Actor) {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (!parts.can.acknowledge) return fail(403, 'Only the staff member can confirm they’ve read it.');
  await db.update(appraisals).set({ status: 'COMPLETED', currentStageOrder: null, updatedAt: new Date() }).where(eq(appraisals.id, id));
  await log(id, 'ACKNOWLEDGED', actor);
  await complete(id);
  return runDetail(id, actor);
}

/** HR can cancel one that isn't finished (a completed appraisal is kept for good). */
export async function cancelRun(id: string, actor: Actor): Promise<'ok' | Fail> {
  const parts = await loadRunParts(id, actor);
  if ('error' in parts) return parts;
  if (!parts.can.cancel) return fail(parts.run.status === 'COMPLETED' ? 409 : 403, parts.run.status === 'COMPLETED' ? 'A completed appraisal is kept for good.' : 'Only HR can cancel an appraisal.');
  await db.transaction(async tx => {
    await tx.delete(appraisalScores).where(eq(appraisalScores.appraisalId, id));
    await tx.delete(appraisalLogs).where(eq(appraisalLogs.appraisalId, id));
    await tx.delete(appraisals).where(eq(appraisals.id, id));
  });
  return 'ok';
}

/**
 * Done: stamped complete, and its total written into the monthly score (one
 * per staff member per month) that the 12-month average and the promotion
 * gate read — so everything that shows appraisals keeps working.
 */
async function complete(id: string) {
  const [run] = await db.select().from(appraisals).where(eq(appraisals.id, id));
  if (!run || run.totalScore == null) return;
  const now = new Date();
  await db.update(appraisals).set({ completedAt: now, updatedAt: now }).where(eq(appraisals.id, id));
  // Two (or more) form appraisals done this month: the month's score is their average, never just the last one.
  const done = await db.select({ total: appraisals.totalScore }).from(appraisals)
    .innerJoin(appraisalTemplates, eq(appraisalTemplates.id, appraisals.templateId))
    .where(and(eq(appraisals.teacherId, run.teacherId), eq(appraisals.periodYear, run.periodYear), eq(appraisals.periodMonth, run.periodMonth),
      eq(appraisals.status, 'COMPLETED'), eq(appraisalTemplates.isLegacy, false)));
  const fields = { score: monthScoreOf(done.map(d => d.total).filter((x): x is number => x != null), run.totalScore), notes: run.comments, evaluatedBy: run.assessedByName, engineAppraisalId: run.id, updatedAt: now };
  const [existing] = await db.select().from(teacherAppraisals).where(and(
    eq(teacherAppraisals.teacherId, run.teacherId), eq(teacherAppraisals.year, run.periodYear), eq(teacherAppraisals.month, run.periodMonth),
  ));
  if (existing) await db.update(teacherAppraisals).set(fields).where(eq(teacherAppraisals.id, existing.id));
  else await db.insert(teacherAppraisals).values({ id: randomUUID(), teacherId: run.teacherId, year: run.periodYear, month: run.periodMonth, createdAt: now, ...fields });
}

// ── Lists ────────────────────────────────────────────────────────────────────

const MONTHS_PER_QUARTER = 3;

/** Does an appraisal's period (a month, quarter or year) include this month? */
export function periodCovers(run: { periodYear: number; periodMonth: number; periodType: string | null }, year: number, month: number): boolean {
  if (run.periodYear !== year) return false;
  if (run.periodType === 'YEARLY') return true;
  if (run.periodType === 'QUARTERLY') return month >= run.periodMonth && month < run.periodMonth + MONTHS_PER_QUARTER;
  return run.periodMonth === month;
}

/**
 * Where an appraisal stands on HRMS → Appraisals, step by step: created but not
 * started → being scored (a draft; also when sent back) → waiting for sign-off
 * → waiting for the staff member to confirm → done.
 */
export type RunStage = 'PENDING' | 'IN_PROGRESS' | 'SIGN_OFF' | 'CONFIRM' | 'DONE';
export function runStage(status: RunStatus, scoredCount: number): RunStage {
  switch (status) {
    case 'COMPLETED': return 'DONE';
    case 'AWAITING_ACKNOWLEDGEMENT': return 'CONFIRM';
    case 'AWAITING_SIGN_OFF': return 'SIGN_OFF';
    case 'SENT_BACK': return 'IN_PROGRESS';
    default: return scoredCount === 0 ? 'PENDING' : 'IN_PROGRESS';
  }
}

/** How many created appraisals the schedule page lists (newest first). */
const CREATED_LIST_LIMIT = 300;

/** Appraisals created from forms (by the schedule), newest first — HRMS → Appraisal schedule → Created appraisals. */
export async function createdAppraisals(scope: StaffScope) {
  const [runs, forms, staff, scored] = await Promise.all([
    db.select().from(appraisals).orderBy(desc(appraisals.createdAt)),
    db.select({ id: appraisalTemplates.id, name: appraisalTemplates.name, isLegacy: appraisalTemplates.isLegacy }).from(appraisalTemplates),
    db.select({ id: teachers.id, name: teachers.name }).from(teachers),
    db.select({ appraisalId: appraisalScores.appraisalId }).from(appraisalScores),
  ]);
  const form = new Map(forms.map(f => [f.id, f]));
  const name = new Map(staff.map(t => [t.id, t.name]));
  const scoredCount = new Map<string, number>();
  for (const s of scored) scoredCount.set(s.appraisalId, (scoredCount.get(s.appraisalId) ?? 0) + 1);
  return runs.filter(r => !form.get(r.templateId)?.isLegacy && inStaffScope(scope, r.teacherId)).slice(0, CREATED_LIST_LIMIT).map(r => ({
    id: r.id, teacherId: r.teacherId, teacherName: name.get(r.teacherId) ?? 'Staff member', formName: form.get(r.templateId)?.name ?? 'Appraisal form',
    period: { year: r.periodYear, month: r.periodMonth }, periodType: r.periodType ?? 'MONTHLY',
    status: r.status as RunStatus, stage: runStage(r.status as RunStatus, scoredCount.get(r.id) ?? 0), totalScore: r.totalScore, createdAt: r.createdAt,
  }));
}

/** Scheduled appraisals (not hand-recorded months) whose period includes this month, per staff member. */
export async function runsCovering(year: number, month: number) {
  const [runs, forms, scored] = await Promise.all([
    db.select().from(appraisals).where(eq(appraisals.periodYear, year)),
    db.select({ id: appraisalTemplates.id, name: appraisalTemplates.name, isLegacy: appraisalTemplates.isLegacy }).from(appraisalTemplates),
    db.select({ appraisalId: appraisalScores.appraisalId }).from(appraisalScores),
  ]);
  const form = new Map(forms.map(f => [f.id, f]));
  const scoredCount = new Map<string, number>();
  for (const s of scored) scoredCount.set(s.appraisalId, (scoredCount.get(s.appraisalId) ?? 0) + 1);
  return runs
    .filter(r => !form.get(r.templateId)?.isLegacy && periodCovers(r, year, month))
    .map(r => ({
      id: r.id, teacherId: r.teacherId, formName: form.get(r.templateId)?.name ?? 'Appraisal form',
      period: { year: r.periodYear, month: r.periodMonth }, periodType: r.periodType ?? 'MONTHLY',
      status: r.status as RunStatus, stage: runStage(r.status as RunStatus, scoredCount.get(r.id) ?? 0), totalScore: r.totalScore,
    }));
}

/** What's waiting for this person: appraisals they score, sign off, or (their own) confirm. */
export async function tasksFor(actor: Actor) {
  const lines = await reportingLines();
  const open = await db.select().from(appraisals).where(and(ne(appraisals.status, 'COMPLETED'), isNotNull(appraisals.currentStageOrder)))
    .orderBy(desc(appraisals.updatedAt));
  const out = [];
  for (const run of open) {
    const template = await loadTemplate(run.templateId);
    if (!template) continue;
    const can = permissions(run, template, actor, lines);
    if (!(can.score || can.signOff || can.acknowledge)) continue;
    const [staff] = await db.select({ name: teachers.name }).from(teachers).where(eq(teachers.id, run.teacherId));
    out.push({
      id: run.id, teacherId: run.teacherId, teacherName: staff?.name ?? 'Staff member', formName: template.name,
      period: { year: run.periodYear, month: run.periodMonth }, status: run.status,
      todo: can.score ? 'SCORE' : can.signOff ? 'SIGN_OFF' : 'ACKNOWLEDGE',
    });
  }
  return out;
}
