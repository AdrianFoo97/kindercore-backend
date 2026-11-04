import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { careerRecords, positions, systemSettings, teacherAllowances, teachers } from '../../db/schema.js';
import {
  completeStaffOnboarding, getMyOnboarding, listStaffOnboarding, saveStaffOnboarding, startStaffOnboarding, tickMyOnboarding,
} from '../../controllers/staff-onboarding.controller.js';
import { createStaffRecord } from '../../services/staffRecord.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { positionRows } from '../fixtures/permissions.js';

// HR → Onboarding: every new staff member works through a checklist copied
// from Settings → Staff Onboarding; HR ticks it off and marks them complete.

const NOW = new Date('2026-01-01T00:00:00Z');
const TASKS = ['Collect IC copy', 'Sign contract', 'Register EPF'];
const OWN_TASKS = ['Read the staff handbook', 'Read the How-To Guides'];
const NEW_JOINER = {
  name: 'Aisyah Rahman', phone: '0123456789', positionId: 'P-CT', level: 0, employmentType: 'full-time' as const,
  joinDate: '2026-02-01', salaryType: 'formula' as const, hasEpf: true, hasSocso: true, hasEis: true,
};

beforeEach(async () => {
  await resetTables(teacherAllowances, careerRecords, teachers, positions, systemSettings);
  await db.insert(positions).values(positionRows);
  await db.insert(systemSettings).values([
    { id: 's-1', key: 'staff_onboarding_tasks', value: TASKS, updatedAt: NOW },
    { id: 's-2', key: 'staff_self_onboarding_tasks', value: OWN_TASKS, updatedAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

const hire = () => db.transaction(tx => createStaffRecord(tx, NEW_JOINER));
async function list() {
  const r = res();
  await listStaffOnboarding(reqWith({}), r);
  return r.body as { id: string; name: string; positionName: string | null; onboardingProgress: { task: string; done: boolean }[] }[];
}
async function save(teacherId: string, progress: { task: string; done: boolean }[]) {
  const r = res();
  await saveStaffOnboarding(reqWith({ params: { teacherId }, body: { progress } }), r);
  return r;
}
async function complete(teacherId: string, force = false) {
  const r = res();
  const request = reqWith({ params: { teacherId } });
  (request as unknown as { query: Record<string, string> }).query = force ? { force: 'true' } : {};
  await completeStaffOnboarding(request, r);
  return r;
}

describe('HR — staff onboarding', () => {
  it('puts every new staff member on the list with a fresh copy of the checklist', async () => {
    const id = await hire();
    const [entry] = await list();
    expect(entry).toMatchObject({ id, name: 'Aisyah Rahman', positionName: 'Class Teacher' });
    expect(entry.onboardingProgress).toEqual(TASKS.map(task => ({ task, done: false })));
  });

  it('leaves staff who were here before onboarding existed off the list', async () => {
    await db.insert(teachers).values({ id: 't-old', name: 'Long-time Lim', color: '#7c3aed', positionId: 'P-CT', createdAt: NOW, updatedAt: NOW });
    expect(await list()).toEqual([]);
  });

  it('drops someone from the list once they have left', async () => {
    const id = await hire();
    await db.update(teachers).set({ resignedAt: NOW }).where(eq(teachers.id, id));
    expect(await list()).toEqual([]);
  });

  it('saves which tasks have been ticked', async () => {
    const id = await hire();
    expect((await save(id, [{ task: 'Collect IC copy', done: true }, { task: 'Sign contract', done: false }])).statusCode).toBe(200);
    const [entry] = await list();
    expect(entry.onboardingProgress).toEqual([{ task: 'Collect IC copy', done: true }, { task: 'Sign contract', done: false }]);
  });

  it('will not mark onboarding complete until both HR\'s list and their own list are done', async () => {
    const id = await hire();
    expect((await complete(id)).statusCode).toBe(400);              // nothing ticked
    await save(id, TASKS.map(task => ({ task, done: true })));
    expect((await complete(id)).statusCode).toBe(400);              // HR done, their own list isn't
    expect(await list()).toHaveLength(1);
    await tickMyOnboarding(reqWith({ params: { teacherId: id }, body: { done: [true, true] } }), res());
    expect((await complete(id)).statusCode).toBe(200);
    expect(await list()).toEqual([]);
  });

  it('"complete all" ticks both lists at once, even when no HR tasks were set up', async () => {
    const id = await hire();
    await save(id, []);
    expect((await complete(id, true)).statusCode).toBe(200);
    const [t] = await db.select().from(teachers).where(eq(teachers.id, id));
    expect(t.onboardingCompleted).toBe(true);
    expect(t.onboardingProgress).toEqual(TASKS.map(task => ({ task, done: true })));
    expect(t.selfOnboardingProgress).toEqual(OWN_TASKS.map(task => ({ task, done: true })));
  });

  it('also gives every new staff member their own checklist, for their app', async () => {
    const id = await hire();
    const r = res();
    await getMyOnboarding(reqWith({ params: { teacherId: id } }), r);
    expect(r.body.tasks).toEqual(OWN_TASKS.map(task => ({ task, done: false })));
  });

  it('lets the new joiner tick their own list, but never rewrite its tasks', async () => {
    const id = await hire();
    const tick = async (done: unknown) => {
      const r = res();
      await tickMyOnboarding(reqWith({ params: { teacherId: id }, body: { done } }), r);
      return r;
    };
    expect((await tick([true, false])).body.tasks).toEqual([{ task: OWN_TASKS[0], done: true }, { task: OWN_TASKS[1], done: false }]);
    expect((await tick([true])).statusCode).toBe(409);                  // stale screen — counts don't match
    expect((await tick([{ task: 'Skip everything', done: true }])).statusCode).toBe(400); // no task text accepted
    const [t] = await db.select().from(teachers).where(eq(teachers.id, id));
    expect(t.selfOnboardingProgress).toEqual([{ task: OWN_TASKS[0], done: true }, { task: OWN_TASKS[1], done: false }]);
  });

  it('can put an existing staff member on onboarding, with fresh copies of both lists', async () => {
    await db.insert(teachers).values({ id: 't-old', name: 'Long-time Lim', color: '#7c3aed', positionId: 'P-CT', createdAt: NOW, updatedAt: NOW });
    const r = res();
    await startStaffOnboarding(reqWith({ params: { teacherId: 't-old' } }), r);
    expect(r.statusCode).toBe(201);
    const [entry] = await list();
    expect(entry).toMatchObject({ id: 't-old', onboardingProgress: TASKS.map(task => ({ task, done: false })) });
    expect((entry as unknown as { selfOnboardingProgress: unknown }).selfOnboardingProgress).toEqual(OWN_TASKS.map(task => ({ task, done: false })));
  });

  it('refuses to start onboarding twice, for someone who has left, or with an empty HR checklist', async () => {
    const start = async (teacherId: string) => {
      const r = res();
      await startStaffOnboarding(reqWith({ params: { teacherId } }), r);
      return r.statusCode;
    };
    const inProgress = await hire();
    expect(await start(inProgress)).toBe(409);
    await db.insert(teachers).values({ id: 't-left', name: 'Gone Goh', color: '#7c3aed', resignedAt: NOW, createdAt: NOW, updatedAt: NOW });
    expect(await start('t-left')).toBe(409);
    await db.insert(teachers).values({ id: 't-old', name: 'Long-time Lim', color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
    await db.update(systemSettings).set({ value: [] }).where(eq(systemSettings.key, 'staff_onboarding_tasks'));
    expect(await start('t-old')).toBe(400);
    expect(await start('nobody')).toBe(404);
  });

  it('refuses a checklist with a blank task, and an unknown staff member', async () => {
    const id = await hire();
    expect((await save(id, [{ task: '  ', done: false }])).statusCode).toBe(400);
    expect((await save('nobody', [])).statusCode).toBe(404);
    expect((await complete('nobody', true)).statusCode).toBe(404);
  });
});
