import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { authRoleModules, authRoleViews, authRoles, pointsTransactions, teachers, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// HRMS by reporting line and by pay, over real HTTP. A Team Lead (the HR
// module alone) sees only the people under them, and no pay anywhere; an HR
// Manager (Whole-school HR) sees everyone without pay; an HR Director (+ See
// pay & salaries) sees everyone, with pay.
//
//   Lee Lead (t-lead) ← Mia Member (t-member) ← Nia Junior (t-junior)
//   Otto Outsider (t-out) reports to nobody in Lee's line.

const NOW = new Date('2026-01-01T00:00:00Z');
const teacher = (id: string, name: string, reportsToTeacherId: string | null) =>
  ({ id, name, color: '#7c3aed', fixedSalaryAmount: 3200, isFixedSalary: true, salaryType: 'fixed', phone: '0123456789', reportsToTeacherId, createdAt: NOW, updatedAt: NOW });

let server: LiveServer;
let lead: Caller;
let manager: Caller;
let director: Caller;

beforeAll(async () => {
  await resetTables(pointsTransactions, userAuthRoles, authRoleViews, authRoleModules, authRoles, users, teachers);
  await db.insert(teachers).values([
    teacher('t-lead', 'Lee Lead', null), teacher('t-member', 'Mia Member', 't-lead'),
    teacher('t-junior', 'Nia Junior', 't-member'), teacher('t-out', 'Otto Outsider', null),
  ]);
  await db.insert(users).values([
    await activeUser({ id: 'u-lead', email: 'lead@kindertech.test', role: 'USER', teacherId: 't-lead', authRoleId: 'builtin:TEAM_LEAD' }),
    await activeUser({ id: 'u-hrm', email: 'hrm@kindertech.test', role: 'USER', authRoleId: 'builtin:HR_MANAGER' }),
    await activeUser({ id: 'u-dir', email: 'dir@kindertech.test', role: 'USER', authRoleId: 'builtin:HR_DIRECTOR' }),
  ]);
  server = await startLiveServer();
  lead = await signIn(server.base, 'lead@kindertech.test', PASSWORD);
  manager = await signIn(server.base, 'hrm@kindertech.test', PASSWORD);
  director = await signIn(server.base, 'dir@kindertech.test', PASSWORD);
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const PAY_FIELD = 'fixedSalaryAmount';

describe('HRMS — a Team Lead sees only their team, and no pay', () => {
  it('lists their team (everyone below them) in full but without pay, and others by name only', async () => {
    const rows = (await lead.call('GET', '/api/planner/teachers')).body as Record<string, unknown>[];
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    for (const id of ['t-member', 't-junior']) {
      expect(byId[id], id).toMatchObject({ phone: '0123456789', reportsToTeacherId: expect.any(String) });
      expect(byId[id], id).not.toHaveProperty(PAY_FIELD);
    }
    expect(Object.keys(byId['t-out']).sort()).toEqual(['color', 'id', 'isActive', 'name', 'outsideTeam']);
    expect(byId['t-lead']).toHaveProperty(PAY_FIELD, 3200); // their own record is theirs to see
  });

  it('opens a team member’s records but refuses someone outside the team', async () => {
    for (const path of ['/api/teachers/:id/career', '/api/teachers/:id/points', '/api/teachers/:id/training']) {
      expect((await lead.call('GET', path.replace(':id', 't-junior'))).status, path).toBe(200);
      expect((await lead.call('GET', path.replace(':id', 't-out'))).status, path).toBe(403);
    }
  });

  it('refuses every kind of pay — a team member’s, and the school’s payroll', async () => {
    for (const path of ['/api/salary/teachers/t-member', '/api/teachers/t-member/allowances', '/api/teachers/t-member/pay-pools',
      '/api/salary/teachers', '/api/salary/payroll-by-month?year=2026', '/api/salary/employer-contributions?year=2026']) {
      expect((await lead.call('GET', path)).status, path).toBe(403);
    }
    expect((await lead.call('PUT', '/api/teachers/t-member/allowances', { allowances: [] })).status).toBe(403);
  });

  it('can change a team member’s details but not their pay or position, and nothing for someone outside the team', async () => {
    expect((await lead.call('PUT', '/api/planner/teachers/t-member', { phone: '0199999999' })).status).toBe(200);
    expect((await lead.call('PUT', '/api/planner/teachers/t-member', { fixedSalaryAmount: 9999 })).status).toBe(403);
    expect((await lead.call('PUT', '/api/planner/teachers/t-member', { level: 5 })).status).toBe(403);
    expect((await lead.call('PUT', '/api/planner/teachers/t-out', { phone: '0199999999' })).status).toBe(403);
    const [member] = await db.select().from(teachers).where(eq(teachers.id, 't-member'));
    expect(member).toMatchObject({ phone: '0199999999', fixedSalaryAmount: 3200 });
  });

  it('grants points to their team only', async () => {
    expect((await lead.call('POST', '/api/teachers/t-member/points/grant', { amount: 10, label: 'Great week' })).status).not.toBe(403);
    expect((await lead.call('POST', '/api/teachers/t-out/points/grant', { amount: 10, label: 'Great week' })).status).toBe(403);
  });

  it('keeps the school-wide HR desks (recruitment, new staff, onboarding, rewards) for whole-school HR', async () => {
    for (const path of ['/api/candidates', '/api/staff-joins', '/api/staff-onboarding', '/api/redemptions']) {
      expect((await lead.call('GET', path)).status, path).toBe(403);
    }
  });
});

describe('HRMS — an HR Manager sees every staff member without pay; an HR Director with pay', () => {
  it('gives an HR Manager everyone and the HR desks, but no pay', async () => {
    const rows = (await manager.call('GET', '/api/planner/teachers')).body as Record<string, unknown>[];
    expect(rows.every(r => !r.outsideTeam && !(PAY_FIELD in r))).toBe(true);
    expect((await manager.call('GET', '/api/candidates')).status).toBe(200);
    for (const path of ['/api/salary/teachers/t-out', '/api/teachers/t-out/allowances', '/api/salary/teachers']) {
      expect((await manager.call('GET', path)).status, path).toBe(403);
    }
  });

  it('lists everyone in full, with pay, and opens anyone’s pay and payroll', async () => {
    const rows = (await director.call('GET', '/api/planner/teachers')).body as Record<string, unknown>[];
    expect(rows.every(r => r[PAY_FIELD] === 3200)).toBe(true);
    for (const path of ['/api/salary/teachers/t-out', '/api/teachers/t-out/allowances', '/api/salary/teachers', '/api/candidates']) {
      expect((await director.call('GET', path)).status, path).toBe(200);
    }
  });
});
