import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalLogs, appraisalSchedules, appraisalScores, appraisalSections,
  appraisalStagePositions, appraisalStages, appraisalTemplates, appraisals, positions, teacherAppraisals, teachers, users,
} from '../../db/schema.js';
import {
  createAppraisalNow, createAppraisalSchedules, deleteAppraisalSchedule, getAppraisalSchedules, getCreatedAppraisals, startAppraisalOneOff,
} from '../../controllers/appraisal-schedules.controller.js';
import { saveAppraisalRunScores } from '../../controllers/appraisal-runs.controller.js';
import { listAppraisalOverview } from '../../controllers/teacher-appraisals.controller.js';
import { runDueSchedules } from '../../services/appraisalSchedules.service.js';
import { activateTemplate, createTemplate, retireTemplate, setFamilyPositions } from '../../services/appraisalTemplates.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// HRMS → Appraisal schedule: HR puts staff on an appraisal form — every month
// on a day, every quarter / year, or once — and the schedule creates each
// appraisal when its day comes. It then shows on HRMS → Appraisals as
// pending, then ongoing, then done. Real handlers, test database.

const NOW = new Date('2026-11-01T00:00:00Z');
const HR = { id: 'u-hr', email: 'hr@kindertech.test', role: 'ADMIN', teacherId: null };
const SAM = { id: 'u-sam', email: 'sam@kindertech.test', role: 'USER', teacherId: 't-sam' };
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { year: y, month: m - 1, day: d }; };

const call = async (handler: (rq: any, rs: any) => Promise<void>, params: Record<string, string> = {}, body: unknown = {}, query: Record<string, string> = {}, user: typeof HR = HR) => {
  const r = res();
  const req = reqWith({ params, body, user }) as any;
  req.query = query;
  await handler(req, r);
  return r;
};
const staff = (id: string, name: string, positionId: string, reportsToTeacherId: string | null = null) =>
  ({ id, name, color: '#7c3aed', positionId, reportsToTeacherId, createdAt: NOW, updatedAt: NOW });

let familyId = '';
const schedule = (over: Record<string, unknown> = {}) =>
  call(createAppraisalSchedules, {}, { familyId, teacherIds: ['t-tina', 't-ben'], repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15', ...over });
const runsFor = (teacherId: string) => db.select().from(appraisals).where(eq(appraisals.teacherId, teacherId));

beforeEach(async () => {
  await resetTables(appraisalSchedules, appraisalLogs, appraisalScores, appraisals, appraisalAssignments, appraisalStagePositions, appraisalStages,
    appraisalCriterionPoints, appraisalCriteria, appraisalSections, appraisalTemplates, teacherAppraisals, teachers, positions, users);
  await db.insert(positions).values([
    { positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW },
    { positionId: 'SUP', name: 'Supervisor', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(teachers).values([staff('t-tina', 'Tina', 'EI', 't-sam'), staff('t-ben', 'Ben', 'EI', 't-sam'), staff('t-sam', 'Sam', 'SUP')]);
  await db.insert(users).values([
    await activeUser({ id: HR.id, email: HR.email, name: 'Hana HR' }),
    await activeUser({ id: SAM.id, email: SAM.email, name: 'Sam Supervisor', role: 'USER', teacherId: 't-sam' }),
  ]);
  familyId = await createTemplate({
    name: 'Monthly EI appraisal', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
    sections: [{ name: 'Care', weight: 100, criteria: [{ name: 'Calm', description: null, weight: 100, inputType: 'YES_NO', scaleConfig: null, points: [] }] }],
    stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] }],
  });
  await setFamilyPositions(familyId, ['EI']);
  await activateTemplate(familyId);
});
afterAll(async () => { await pool.end(); });

describe('Appraisal schedule — setting it up', () => {
  it('puts several staff on a form at once, says when each next one is made, and won\'t double a repeating schedule', async () => {
    expect((await schedule()).body).toEqual({ created: 2 });
    const list = (await call(getAppraisalSchedules)).body;
    expect(list.map((s: any) => [s.teacherName, s.formName, s.repeat, s.status])).toEqual([
      ['Ben', 'Monthly EI appraisal', 'MONTHLY', 'ONGOING'], ['Tina', 'Monthly EI appraisal', 'MONTHLY', 'ONGOING'],
    ]);
    expect(list[0].nextOn).toMatch(/^\d{4}-\d{2}-01$/);
    const again = await schedule({ teacherIds: ['t-tina'] });
    expect(again.statusCode).toBe(409);
    expect(again.body.message).toBe('Already on a repeating schedule for this form: Tina.');
  });

  it('checks the rule, only schedules a live form, and only for the positions it is for', async () => {
    expect((await schedule({ dayOfMonth: 31 })).body.message).toBe('Pick a day from 1 to 28.');
    expect((await schedule({ teacherIds: [] })).statusCode).toBe(400);
    // The form is for Junior EIs only — Sam (a Supervisor) can't be put on it.
    expect((await schedule({ teacherIds: ['t-tina', 't-sam'] })).body.message).toBe('This form is for Junior EI only — not Sam.');
    await retireTemplate(familyId);
    expect((await schedule()).body.message).toBe('Make the appraisal form live first.');
  });
});

describe('Appraisal schedule — creating the appraisals', () => {
  it('creates each appraisal when its day comes, pending on the live form, and only once per period', async () => {
    await schedule();
    expect(await runDueSchedules(day('2026-11-20'))).toEqual({ created: 0, skipped: 0 }); // 1 Nov was before it started
    expect(await runDueSchedules(day('2026-12-01'))).toEqual({ created: 2, skipped: 0 });
    expect(await runDueSchedules(day('2026-12-05'))).toEqual({ created: 0, skipped: 0 }); // already made for December
    const [run] = await runsFor('t-tina');
    expect(run).toMatchObject({ periodYear: 2026, periodMonth: 11, periodType: 'MONTHLY', status: 'IN_PROGRESS' });
    const [log] = await db.select().from(appraisalLogs).where(eq(appraisalLogs.appraisalId, run.id));
    expect(log).toMatchObject({ kind: 'STARTED', authorName: 'Appraisal schedule' });
    // Listed under Created appraisals, newest first, pending until something is scored.
    expect((await call(getCreatedAppraisals)).body.map((r: any) => [r.teacherName, r.stage]).sort()).toEqual([['Ben', 'PENDING'], ['Tina', 'PENDING']]);
  });

  it('stops once someone is taken off — the appraisals already made stay', async () => {
    await schedule();
    await runDueSchedules(day('2026-12-01'));
    const tina = (await call(getAppraisalSchedules)).body.find((s: any) => s.teacherName === 'Tina');
    expect((await call(deleteAppraisalSchedule, { id: tina.id })).statusCode).toBe(204);
    await runDueSchedules(day('2027-01-01'));
    expect(await runsFor('t-tina')).toHaveLength(1);
    expect(await runsFor('t-ben')).toHaveLength(2);
  });

  it('does a one-off once, and "Create now" makes this period\'s straight away', async () => {
    await schedule({ repeat: 'ONCE', teacherIds: ['t-tina'], startsOn: '2026-12-03' });
    await runDueSchedules(day('2026-12-02'));
    expect(await runsFor('t-tina')).toHaveLength(0);
    await runDueSchedules(day('2026-12-03'));
    await runDueSchedules(day('2027-01-03'));
    expect(await runsFor('t-tina')).toHaveLength(1);
    expect((await call(getAppraisalSchedules)).body[0]).toMatchObject({ status: 'FINISHED', nextOn: null });

    await schedule({ teacherIds: ['t-ben'], startsOn: '2026-11-15' });
    const ben = (await call(getAppraisalSchedules)).body.find((s: any) => s.teacherName === 'Ben');
    expect((await call(createAppraisalNow, { id: ben.id })).statusCode).toBe(201);
    expect((await call(createAppraisalNow, { id: ben.id })).statusCode).toBe(409); // one per period
  });

  it('skips a form that isn\'t live, and tries again once it is', async () => {
    await schedule({ teacherIds: ['t-tina'] });
    await retireTemplate(familyId);
    expect(await runDueSchedules(day('2026-12-01'))).toEqual({ created: 0, skipped: 1 });
    expect((await call(getAppraisalSchedules)).body[0].status).toBe('PAUSED');
  });
});

describe('HRMS → Appraisals — a one-off, now', () => {
  it('starts one for someone straight away on a form for their position, once per month', async () => {
    const start = (teacherId: string) => call(startAppraisalOneOff, { }, { teacherId, familyId, year: 2026, month: 10 });
    const made = await start('t-tina');
    expect(made.statusCode).toBe(201);
    expect((await runsFor('t-tina'))[0]).toMatchObject({ periodType: 'ONCE', periodMonth: 10, status: 'IN_PROGRESS' });
    expect((await start('t-tina')).statusCode).toBe(409); // already one this month
    // The form is for Junior EIs — not Sam, a Supervisor.
    expect((await start('t-sam')).body.message).toBe('This form is for Junior EI only — not Sam.');
  });
});
describe('HRMS → Appraisals — scheduled appraisals', () => {
  it('shows them for the month as pending, then in progress once a draft is saved', async () => {
    await schedule();
    await runDueSchedules(day('2026-12-01'));
    const month = async () => (await call(listAppraisalOverview, {}, {}, { year: '2026', month: '11' })).body.staff;
    const tina = async () => (await month()).find((s: any) => s.teacherId === 't-tina');
    expect((await tina()).runs).toMatchObject([{ formName: 'Monthly EI appraisal', stage: 'PENDING', status: 'IN_PROGRESS' }]);
    expect((await month()).find((s: any) => s.teacherId === 't-sam').runs).toEqual([]);
    // Sam saves a draft → in progress.
    const runId = (await tina()).runs[0].id;
    const [calm] = await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Calm'));
    await call(saveAppraisalRunScores, { id: runId }, { scores: [{ criterionId: calm.id, rawValue: 1 }] }, {}, SAM);
    expect((await tina()).runs[0].stage).toBe('IN_PROGRESS');
  });
});
