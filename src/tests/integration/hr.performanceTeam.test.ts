import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalLogs, appraisalSchedules, appraisalScores, appraisalSections,
  appraisalStagePositions, appraisalStages, appraisalTemplates, appraisals, authRoleModules, authRoleViews, authRoles, positions,
  sopObservations, sopTemplates, teacherAppraisals, teachers, users,
} from '../../db/schema.js';
import { createAppraisalSchedules, getAppraisalSchedules, getPerformanceStaff } from '../../controllers/appraisal-schedules.controller.js';
import { cancelAppraisalRun, getAppraisalRun } from '../../controllers/appraisal-runs.controller.js';
import { listAppraisalOverview, listAppraisals, upsertAppraisal } from '../../controllers/teacher-appraisals.controller.js';
import { getObservation, listObservations } from '../../controllers/sop-observations.controller.js';
import { SCHEDULER, createRun } from '../../services/appraisalRuns.service.js';
import { OUTSIDE_TEAM, SEE_ALL_STAFF_VIEW } from '../../services/performanceScope.service.js';
import { activateTemplate, createTemplate, setFamilyPositions } from '../../services/appraisalTemplates.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// HRMS → Performance Management (Appraisals, Appraisal schedule, Practice
// Observations) shows each person only their team — the staff who report to
// them, directly or further down — unless their access role may see everyone
// (or they're an admin). Real handlers, test database.
//
// Sam (Supervisor, HR module, no "see everyone") ← Tina reports to Sam ← Ben reports to Tina.
// Oli (Supervisor) ← Zed reports to Oli — not Sam's team.

const NOW = new Date('2026-11-01T00:00:00Z');
const SAM = { id: 'u-sam', email: 'sam@kindertech.test', role: 'USER', teacherId: 't-sam' };
const HANA = { id: 'u-hana', email: 'hana@kindertech.test', role: 'USER', teacherId: null }; // HR officer who may see everyone
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
type Caller = typeof SAM | typeof HANA;

const call = async (handler: (rq: any, rs: any) => Promise<void>, user: Caller, params: Record<string, string> = {}, body: unknown = {}, query: Record<string, string> = {}) => {
  const r = res();
  const req = reqWith({ params, body, user }) as any;
  req.query = query;
  await handler(req, r);
  return r;
};
const staff = (id: string, name: string, positionId: string, reportsToTeacherId: string | null = null) =>
  ({ id, name, color: '#7c3aed', positionId, reportsToTeacherId, isActive: true, createdAt: NOW, updatedAt: NOW });

let familyId = '';

beforeEach(async () => {
  await resetTables(appraisalSchedules, appraisalLogs, appraisalScores, appraisals, appraisalAssignments, appraisalStagePositions, appraisalStages,
    appraisalCriterionPoints, appraisalCriteria, appraisalSections, appraisalTemplates, teacherAppraisals, sopObservations, sopTemplates,
    users, authRoleViews, authRoleModules, authRoles, teachers, positions);
  await db.insert(positions).values([
    { positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW },
    { positionId: 'SUP', name: 'Supervisor', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(teachers).values([
    staff('t-sam', 'Sam', 'SUP'), staff('t-tina', 'Tina', 'EI', 't-sam'), staff('t-ben', 'Ben', 'EI', 't-tina'),
    staff('t-oli', 'Oli', 'SUP'), staff('t-zed', 'Zed', 'EI', 't-oli'),
  ]);
  await db.insert(authRoles).values([
    { id: 'role-sup', name: 'Supervisor', createdAt: NOW, updatedAt: NOW },
    { id: 'role-hr', name: 'HR officer', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(authRoleModules).values([
    { id: 'arm-sup', authRoleId: 'role-sup', module: 'HR', createdAt: NOW },
    { id: 'arm-hr', authRoleId: 'role-hr', module: 'HR', createdAt: NOW },
  ]);
  await db.insert(authRoleViews).values({ id: 'arv-hr', authRoleId: 'role-hr', view: SEE_ALL_STAFF_VIEW, createdAt: NOW });
  await db.insert(users).values([
    await activeUser({ id: SAM.id, email: SAM.email, name: 'Sam Supervisor', role: 'USER', teacherId: 't-sam', authRoleId: 'role-sup' }),
    await activeUser({ id: HANA.id, email: HANA.email, name: 'Hana HR', role: 'USER', authRoleId: 'role-hr' }),
    await activeUser({ id: ADMIN.id, email: ADMIN.email, name: 'Ada Admin' }),
  ]);
  familyId = await createTemplate({
    name: 'Monthly EI appraisal', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
    sections: [{ name: 'Care', weight: 100, criteria: [{ name: 'Calm', description: null, weight: 100, inputType: 'YES_NO', scaleConfig: null, points: [] }] }],
    stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] }],
  });
  await setFamilyPositions(familyId, ['EI']);
  await activateTemplate(familyId);
  await db.insert(sopTemplates).values({ id: 'sop-1', title: 'Morning drop-off', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopObservations).values([
    { id: 'obs-tina', teacherId: 't-tina', sopTemplateId: 'sop-1', status: 'PENDING_TRAINER', createdAt: NOW, updatedAt: NOW },
    { id: 'obs-zed', teacherId: 't-zed', sopTemplateId: 'sop-1', status: 'PENDING_TRAINER', createdAt: NOW, updatedAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

const names = (rows: { name?: string; teacherName?: string }[]) => rows.map(r => r.name ?? r.teacherName).sort();

describe('Performance Management — only your team', () => {
  it('shows a supervisor only the staff who report to them — directly or further down', async () => {
    expect(names((await call(getPerformanceStaff, SAM)).body)).toEqual(['Ben', 'Tina']);
    const month = (await call(listAppraisalOverview, SAM, {}, {}, { year: '2026', month: '10' })).body.staff;
    expect(month.map((s: any) => s.teacherId).sort()).toEqual(['t-ben', 't-tina']);
    expect((await call(listObservations, SAM)).body.map((o: any) => o.teacherName)).toEqual(['Tina']);
    // Schedules for both teams exist — Sam sees only his team's.
    await call(createAppraisalSchedules, HANA, {}, { familyId, teacherIds: ['t-tina', 't-zed'], repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15' });
    expect(names((await call(getAppraisalSchedules, SAM)).body)).toEqual(['Tina']);
  });

  it('refuses a supervisor anyone outside their team, but always lets them see their own', async () => {
    const outside = await call(createAppraisalSchedules, SAM, {}, { familyId, teacherIds: ['t-tina', 't-zed'], repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15' });
    expect(outside.statusCode).toBe(403);
    expect(outside.body.message).toBe('Only staff in your team can be scheduled — not Zed.');
    expect((await call(getObservation, SAM, { id: 'obs-zed' })).body.message).toBe(OUTSIDE_TEAM);
    expect((await call(upsertAppraisal, SAM, { teacherId: 't-zed' }, { year: 2026, month: 10, score: 80 })).statusCode).toBe(403);
    expect((await call(listAppraisals, SAM, { teacherId: 't-zed' })).statusCode).toBe(403);
    expect((await call(listAppraisals, SAM, { teacherId: 't-sam' })).statusCode).toBe(200); // his own
    // An appraisal of someone outside his team: not his to open or cancel.
    const zed = await createRun('t-zed', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string };
    expect((await call(getAppraisalRun, SAM, { id: zed.id })).statusCode).toBe(403);
    expect((await call(cancelAppraisalRun, SAM, { id: zed.id })).statusCode).toBe(403);
    const tina = await createRun('t-tina', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string };
    expect((await call(getAppraisalRun, SAM, { id: tina.id })).statusCode).toBe(200);
  });

  it('lets admins, and anyone whose access role may see every staff member, see everyone', async () => {
    const everyone = ['Ben', 'Oli', 'Sam', 'Tina', 'Zed'];
    expect(names((await call(getPerformanceStaff, HANA)).body)).toEqual(everyone);
    expect(names((await call(getPerformanceStaff, ADMIN)).body)).toEqual(everyone);
    expect((await call(getObservation, HANA, { id: 'obs-zed' })).statusCode).toBe(200);
  });
});
