import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appraisalAssignments, appraisalSchedules, appraisalTemplates, positions, teachers } from '../db/schema.js';
import { SCHEDULER, createRun, type LogAuthor } from './appraisalRuns.service.js';
import { ALL_STAFF, OUTSIDE_TEAM, inStaffScope, type StaffScope } from './performanceScope.service.js';
import {
  dueToday, formatDay, malaysiaToday, nextDue, parseDay, periodFor, periodKey, ruleProblem,
  type Day, type ScheduleRepeat, type ScheduleRule,
} from './appraisalSchedule.logic.js';

// HRMS → Appraisal schedule: put staff on an appraisal form, repeating or
// once. runDueSchedules (hourly, from server.ts) creates each appraisal when
// its day comes; it then shows as pending on HRMS → Appraisals. Removing a
// schedule stops future ones — appraisals already created stay.

type Fail = { error: string; status: number };
const fail = (status: number, error: string): Fail => ({ error, status });
type Row = typeof appraisalSchedules.$inferSelect;

const ruleOf = (s: Row): ScheduleRule => ({
  repeat: s.repeatEvery as ScheduleRepeat, dayOfMonth: s.dayOfMonth, monthOfYear: s.monthOfYear, startsOn: s.startsOn, lastPeriodKey: s.lastPeriodKey,
});

async function formsByFamily() {
  const rows = await db.select().from(appraisalTemplates).where(eq(appraisalTemplates.isLegacy, false));
  // One entry per form: the live version's name, else the newest version's.
  const out = new Map<string, { name: string; live: boolean; version: number }>();
  for (const t of rows) {
    const seen = out.get(t.familyId);
    if (t.status === 'ACTIVE') out.set(t.familyId, { name: t.name, live: true, version: t.version });
    else if (!seen || (!seen.live && t.version > seen.version)) out.set(t.familyId, { name: t.name, live: false, version: t.version });
  }
  return out;
}

/** Every schedule, with who, which form, the rule, and the next day it will create one. */
export async function listSchedules(scope: StaffScope = ALL_STAFF, today: Day = malaysiaToday()) {
  const [rows, staff, positionRows, forms] = await Promise.all([
    db.select().from(appraisalSchedules),
    db.select({ id: teachers.id, name: teachers.name, positionId: teachers.positionId, isActive: teachers.isActive }).from(teachers),
    db.select({ id: positions.positionId, name: positions.name }).from(positions),
    formsByFamily(),
  ]);
  const person = new Map(staff.map(t => [t.id, t]));
  const positionName = new Map(positionRows.map(p => [p.id, p.name]));
  return rows
    .filter(s => person.has(s.teacherId) && inStaffScope(scope, s.teacherId))
    .map(s => {
      const t = person.get(s.teacherId)!;
      const form = forms.get(s.templateFamilyId);
      const next = nextDue(ruleOf(s), today);
      const status = !next ? 'FINISHED' : !form?.live || !t.isActive ? 'PAUSED' : 'ONGOING';
      return {
        id: s.id, teacherId: s.teacherId, teacherName: t.name, positionName: t.positionId ? positionName.get(t.positionId) ?? null : null,
        familyId: s.templateFamilyId, formName: form?.name ?? 'Appraisal form', formLive: !!form?.live,
        repeat: s.repeatEvery, dayOfMonth: s.dayOfMonth, monthOfYear: s.monthOfYear, startsOn: s.startsOn,
        nextOn: next ? formatDay(next) : null, status,
      };
    })
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName) || a.formName.localeCompare(b.formName));
}

export interface ScheduleInput {
  familyId: string;
  teacherIds: string[];
  repeat: ScheduleRepeat;
  dayOfMonth: number;
  monthOfYear: number | null;
  startsOn: string;
}

/** The positions an appraisal form is for ("Who it's for"), by id and name. */
async function positionsOfForm(familyId: string): Promise<{ ids: string[]; names: string[] }> {
  const rows = await db.select({ positionId: appraisalAssignments.positionId }).from(appraisalAssignments)
    .where(eq(appraisalAssignments.templateFamilyId, familyId));
  const ids = rows.map(r => r.positionId).filter((p): p is string => !!p);
  const named = ids.length ? await db.select({ id: positions.positionId, name: positions.name }).from(positions).where(inArray(positions.positionId, ids)) : [];
  return { ids, names: ids.map(id => named.find(p => p.id === id)?.name ?? id) };
}

/** Put staff on a form (one schedule each). A repeating schedule can't be doubled up for the same person and form. */
export async function createSchedules(input: ScheduleInput, userId: string, scope: StaffScope = ALL_STAFF): Promise<{ created: number } | Fail> {
  const problem = ruleProblem(input);
  if (problem) return fail(400, problem);
  const teacherIds = [...new Set(input.teacherIds)];
  if (teacherIds.length === 0) return fail(400, 'Pick at least one staff member.');
  const forms = await formsByFamily();
  const form = forms.get(input.familyId);
  if (!form) return fail(404, 'Appraisal form not found');
  if (!form.live) return fail(400, 'Make the appraisal form live first.');
  const staff = await db.select({ id: teachers.id, name: teachers.name, positionId: teachers.positionId }).from(teachers).where(inArray(teachers.id, teacherIds));
  if (staff.length !== teacherIds.length) return fail(404, 'A staff member wasn’t found.');
  const outside = staff.filter(t => !inStaffScope(scope, t.id)).map(t => t.name);
  if (outside.length) return fail(403, `Only staff in your team can be scheduled — not ${outside.join(', ')}.`);
  // A form is for the positions set under "Who it's for" — only staff in them can be put on it.
  const formPositions = await positionsOfForm(input.familyId);
  const wrong = staff.filter(t => !t.positionId || !formPositions.ids.includes(t.positionId)).map(t => t.name);
  if (wrong.length) return fail(400, `This form is for ${formPositions.names.join(', ')} only — not ${wrong.join(', ')}.`);
  if (input.repeat !== 'ONCE') {
    const existing = await db.select().from(appraisalSchedules)
      .where(and(eq(appraisalSchedules.templateFamilyId, input.familyId), inArray(appraisalSchedules.teacherId, teacherIds)));
    const doubled = existing.filter(s => s.repeatEvery !== 'ONCE').map(s => staff.find(t => t.id === s.teacherId)?.name).filter(Boolean);
    if (doubled.length) return fail(409, `Already on a repeating schedule for this form: ${doubled.join(', ')}.`);
  }
  const now = new Date();
  await db.insert(appraisalSchedules).values(teacherIds.map(teacherId => ({
    id: randomUUID(), teacherId, templateFamilyId: input.familyId, repeatEvery: input.repeat,
    dayOfMonth: input.repeat === 'ONCE' ? parseDay(input.startsOn).day : input.dayOfMonth,
    monthOfYear: input.repeat === 'YEARLY' ? input.monthOfYear : null,
    startsOn: input.startsOn, lastPeriodKey: null, createdByUserId: userId, createdAt: now, updatedAt: now,
  })));
  return { created: teacherIds.length };
}

/** Take someone off a schedule: no more appraisals from it. Ones already created stay. */
export async function removeSchedule(id: string, scope: StaffScope = ALL_STAFF): Promise<'ok' | Fail> {
  const [s] = await db.select({ id: appraisalSchedules.id, teacherId: appraisalSchedules.teacherId }).from(appraisalSchedules).where(eq(appraisalSchedules.id, id));
  if (!s) return fail(404, 'Schedule not found');
  if (!inStaffScope(scope, s.teacherId)) return fail(403, OUTSIDE_TEAM);
  await db.delete(appraisalSchedules).where(eq(appraisalSchedules.id, id));
  return 'ok';
}

const markMade = (id: string, key: number) =>
  db.update(appraisalSchedules).set({ lastPeriodKey: key, updatedAt: new Date() }).where(eq(appraisalSchedules.id, id));

/** "Create now": this period's appraisal from a schedule, without waiting for its day. */
export async function createNow(id: string, author: LogAuthor, scope: StaffScope = ALL_STAFF, today: Day = malaysiaToday()): Promise<{ id: string } | Fail> {
  const [s] = await db.select().from(appraisalSchedules).where(eq(appraisalSchedules.id, id));
  if (!s) return fail(404, 'Schedule not found');
  if (!inStaffScope(scope, s.teacherId)) return fail(403, OUTSIDE_TEAM);
  const rule = ruleOf(s);
  const start = parseDay(s.startsOn);
  const period = rule.repeat === 'ONCE' ? periodFor('MONTHLY', start.year, start.month) : periodFor(rule.repeat, today.year, today.month);
  const made = await createRun(s.teacherId, s.templateFamilyId, rule.repeat, period, author);
  if ('error' in made) return made;
  await markMade(s.id, Math.max(periodKey(period), s.lastPeriodKey ?? -1));
  return made;
}

/**
 * The scheduler: create every appraisal whose day has come. Safe to run any
 * time — each schedule makes one per period at most. A form that isn't live
 * (or someone who has left) is skipped and tried again on the next run.
 */
export async function runDueSchedules(today: Day = malaysiaToday()): Promise<{ created: number; skipped: number }> {
  const [rows, staff] = await Promise.all([
    db.select().from(appraisalSchedules),
    db.select({ id: teachers.id, isActive: teachers.isActive }).from(teachers),
  ]);
  const active = new Set(staff.filter(t => t.isActive).map(t => t.id));
  let created = 0;
  let skipped = 0;
  for (const s of rows) {
    const due = dueToday(ruleOf(s), today);
    if (!due) continue;
    if (!active.has(s.teacherId)) { skipped++; continue; }
    const made = await createRun(s.teacherId, s.templateFamilyId, s.repeatEvery, due.period, SCHEDULER);
    if ('error' in made && made.status !== 409) { skipped++; continue; }
    if (!('error' in made)) created++;
    // Made now, or already there (made by hand): either way this period is done.
    await markMade(s.id, periodKey(due.period));
  }
  return { created, skipped };
}

/** Staff someone may appraise or observe (their scope), still working here, A–Z — for the pickers in Performance Management. */
export async function staffInScope(scope: StaffScope) {
  const [staff, positionRows] = await Promise.all([
    db.select({ id: teachers.id, name: teachers.name, positionId: teachers.positionId, isActive: teachers.isActive }).from(teachers),
    db.select({ id: positions.positionId, name: positions.name }).from(positions),
  ]);
  const positionName = new Map(positionRows.map(p => [p.id, p.name]));
  return staff.filter(t => t.isActive && inStaffScope(scope, t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => ({ id: t.id, name: t.name, positionId: t.positionId, positionName: t.positionId ? positionName.get(t.positionId) ?? null : null }));
}

/**
 * HRMS → Appraisals → New appraisal: one appraisal for someone right now (a
 * one-off, no schedule), for a month. Same rules as scheduling: someone in
 * your scope, a live form, and a form meant for their position.
 */
export async function startOneOff(
  teacherId: string, familyId: string, period: { year: number; month: number }, author: LogAuthor, scope: StaffScope = ALL_STAFF,
  /** They've seen the "already has one this month" warning and want a second anyway. */
  secondAnyway = false,
): Promise<{ id: string } | Fail> {
  const [t] = await db.select({ id: teachers.id, name: teachers.name, positionId: teachers.positionId }).from(teachers).where(eq(teachers.id, teacherId));
  if (!t) return fail(404, 'Staff member not found');
  if (!inStaffScope(scope, t.id)) return fail(403, OUTSIDE_TEAM);
  const formPositions = await positionsOfForm(familyId);
  if (!t.positionId || !formPositions.ids.includes(t.positionId)) return fail(400, `This form is for ${formPositions.names.join(', ')} only — not ${t.name}.`);
  return createRun(teacherId, familyId, 'ONCE', period, author, secondAnyway ? 'allow' : 'warn');
}