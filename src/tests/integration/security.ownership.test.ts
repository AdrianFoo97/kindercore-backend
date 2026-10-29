import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  users, teachers, positions, authRoles, authRoleModules, authRoleViews, rewardRedemptions, pointsTransactions,
} from '../../db/schema.js';
import { selfOrModule, requireAnyModule } from '../../middlewares/auth.middleware.js';
import { getTeachers, updateTeacher } from '../../controllers/planner.controller.js';
import { grantPoints, getRedemption } from '../../controllers/points.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res, nextSpy } from './http.js';
import { authRoleRows, moduleRows, viewRows, positionRows, teacherRows, userRows, USER_ID } from '../fixtures/permissions.js';

// "Your own record, not someone else's" — against the real (test) DB.
// Fixtures (../fixtures/permissions.ts):
//   u-teacher → teacher t-1, no HR      u-office → HR module, no teacher
//   u-both    → HR module + teacher t-2 u-nobody → nothing
// plus u-tools (Tools module only), added here.

const NOW = new Date('2026-01-01T00:00:00Z');
const as = (id: string, teacherId: string | null = null, role = 'USER') => ({ id, email: `${id}@kindertech.test`, role, teacherId });
const TEACHER = as(USER_ID.teacher, 't-1');
const BOTH = as(USER_ID.both, 't-2');
const OFFICE = as(USER_ID.office);
const NOBODY = as(USER_ID.nobody);
const TOOLS = as('u-tools');

beforeEach(async () => {
  await resetTables(pointsTransactions, rewardRedemptions, users, teachers, positions, authRoleViews, authRoleModules, authRoles);
  await db.insert(authRoles).values([...authRoleRows, { id: 'role-tools', name: 'Planner', createdAt: NOW, updatedAt: NOW }]);
  await db.insert(authRoleModules).values([...moduleRows, { id: 'arm-tools', authRoleId: 'role-tools', module: 'TOOLS', createdAt: NOW }]);
  await db.insert(authRoleViews).values(viewRows);
  await db.insert(positions).values(positionRows);
  await db.insert(teachers).values(teacherRows.map(t => ({ ...t, fixedSalaryAmount: 3200, phone: '0123456789' })));
  await db.insert(users).values([
    ...userRows,
    { id: 'u-tools', email: 'u-tools@kindertech.test', name: 'Planner', passwordHash: 'x', role: 'USER', activated: true, authRoleId: 'role-tools', createdAt: NOW, updatedAt: NOW },
  ]);
  // HR's existing module fixture lives on the office role; give it HR explicitly.
  await db.update(authRoleModules).set({ module: 'HR' }).where(eq(authRoleModules.id, 'arm-1'));
});
afterAll(async () => {
  await pool.end();
});

async function gate(mw: ReturnType<typeof selfOrModule>, user: ReturnType<typeof as>, params: Record<string, string> = {}) {
  const r = res();
  const next = nextSpy();
  await mw(reqWith({ user, params }), r, next);
  return next.called;
}

describe('Security — a teacher\'s own record (selfOrModule)', () => {
  it('lets a teacher open their own record', async () => {
    expect(await gate(selfOrModule('HR'), TEACHER, { teacherId: 't-1' })).toBe(true);
  });

  it('stops a teacher opening another teacher\'s record by changing the id', async () => {
    expect(await gate(selfOrModule('HR'), TEACHER, { teacherId: 't-2' })).toBe(false);
  });

  it('lets HR staff open any teacher\'s record', async () => {
    expect(await gate(selfOrModule('HR'), OFFICE, { teacherId: 't-1' })).toBe(true);
  });

  it('refuses someone with no teacher record and no HR access', async () => {
    expect(await gate(selfOrModule('HR'), NOBODY, { teacherId: 't-1' })).toBe(false);
  });

  it('lets Admins open any record', async () => {
    expect(await gate(selfOrModule('HR'), as('admin', null, 'ADMIN'), { teacherId: 't-1' })).toBe(true);
  });
});

describe('Security — shared areas (requireAnyModule)', () => {
  it('allows staff holding any one of the listed modules', async () => {
    expect(await gate(requireAnyModule('FINANCE', 'HR'), OFFICE)).toBe(true);
  });

  it('refuses staff holding none of them', async () => {
    expect(await gate(requireAnyModule('FINANCE', 'HR'), TEACHER)).toBe(false);
  });
});

describe('Security — staff list and pay fields', () => {
  it('shows a teacher only names of colleagues — no salary, phone or date of birth', async () => {
    const r = res();
    await getTeachers(reqWith({ user: TEACHER }), r);
    const other = r.body.find((t: { id: string }) => t.id === 't-2');
    expect(Object.keys(other).sort()).toEqual(['color', 'id', 'isActive', 'name']);
  });

  it('still gives a teacher their own full record', async () => {
    const r = res();
    await getTeachers(reqWith({ user: TEACHER }), r);
    expect(r.body.find((t: { id: string }) => t.id === 't-1')).toMatchObject({ fixedSalaryAmount: 3200 });
  });

  it('gives HR staff everyone\'s full record', async () => {
    const r = res();
    await getTeachers(reqWith({ user: OFFICE }), r);
    expect(r.body.every((t: { fixedSalaryAmount?: number }) => t.fixedSalaryAmount === 3200)).toBe(true);
  });

  it('lets Planner (Tools) staff change a teacher\'s schedule', async () => {
    const r = res();
    await updateTeacher(reqWith({ user: TOOLS, params: { id: 't-1' }, body: { workDays: [0, 1, 2] } }), r);
    expect(r.statusCode).toBe(200);
  });

  it('stops Planner (Tools) staff changing pay', async () => {
    const r = res();
    await updateTeacher(reqWith({ user: TOOLS, params: { id: 't-1' }, body: { fixedSalaryAmount: 9999 } }), r);
    expect(r.statusCode).toBe(403);
    const [row] = await db.select().from(teachers).where(eq(teachers.id, 't-1'));
    expect(row.fixedSalaryAmount).toBe(3200);
  });

  it('does not block a form that re-sends unchanged pay values', async () => {
    const r = res();
    await updateTeacher(reqWith({ user: TOOLS, params: { id: 't-1' }, body: { fixedSalaryAmount: 3200, workDays: [1] } }), r);
    expect(r.statusCode).toBe(200);
  });

  it('lets HR change pay', async () => {
    const r = res();
    await updateTeacher(reqWith({ user: OFFICE, params: { id: 't-1' }, body: { fixedSalaryAmount: 3500 } }), r);
    expect(r.statusCode).toBe(200);
  });
});

describe('Security — points and rewards', () => {
  it('stops HR staff granting points to their own teacher account', async () => {
    const r = res();
    await grantPoints(reqWith({ user: BOTH, params: { teacherId: 't-2' }, body: { amount: 500, label: 'Bonus' } }), r);
    expect(r.statusCode).toBe(403);
    expect((await db.select().from(pointsTransactions)).length).toBe(0);
  });

  it('still lets HR staff grant points to someone else', async () => {
    const r = res();
    await grantPoints(reqWith({ user: BOTH, params: { teacherId: 't-1' }, body: { amount: 50, label: 'Helped at open day' } }), r);
    expect(r.statusCode).not.toBe(403);
    expect((await db.select().from(pointsTransactions)).length).toBe(1);
  });

  it('shows a redemption only to its owner (or HR / Admin)', async () => {
    await db.insert(rewardRedemptions).values({
      id: 'rd-1', teacherId: 't-2', rewardId: 'rw-1', label: 'Movie voucher', icon: 'ticket', pointsSpent: 200,
      redemptionCode: 'KC-0001', redeemedDate: '2026-01-02', createdAt: NOW, updatedAt: NOW,
    });
    const look = async (user: ReturnType<typeof as>) => {
      const r = res();
      await getRedemption(reqWith({ user, params: { id: 'rd-1' } }), r);
      return r.statusCode;
    };
    expect(await look(BOTH)).toBe(200);    // owner
    expect(await look(OFFICE)).toBe(200);  // HR
    expect(await look(TEACHER)).toBe(404); // another teacher — not even told it exists
  });
});
