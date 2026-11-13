import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { careerMissions, teacherMissionProgress, teachers } from '../../db/schema.js';
import { MAX_FOCUS_MISSIONS, setMissionTarget } from '../../controllers/career-missions.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Career → Current Focus: a teacher pins quests to focus on, at most three
// unfinished ones at a time, so Home stays a short list. Real handler, test DB.

const NOW = new Date('2026-01-01T00:00:00Z');
const TEACHER = 't-tina';
const ME = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: TEACHER };
const missionIds = ['m1', 'm2', 'm3', 'm4'];

beforeEach(async () => {
  await resetTables(teacherMissionProgress, careerMissions, teachers);
  await db.insert(teachers).values({ id: TEACHER, name: 'Tina', color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
  await db.insert(careerMissions).values(missionIds.map(id => ({
    id, positionId: 'P1', title: `Quest ${id}`, category: 'CLASSROOM', createdAt: NOW, updatedAt: NOW,
  })));
});
afterAll(async () => {
  await pool.end();
});

const pin = async (missionId: string, isTargeted = true) => {
  const r = res();
  await setMissionTarget(reqWith({ user: ME, params: { teacherId: TEACHER, missionId }, body: { isTargeted } }), r);
  return r;
};
const pinnedIds = async () => (await db.select().from(teacherMissionProgress)
  .where(and(eq(teacherMissionProgress.teacherId, TEACHER), eq(teacherMissionProgress.isTargeted, true)))).map(p => p.missionId).sort();

describe('Career — Current Focus limit', () => {
  it('lets a teacher pin up to three quests, and refuses a fourth with a reason', async () => {
    expect(MAX_FOCUS_MISSIONS).toBe(3);
    for (const id of ['m1', 'm2', 'm3']) expect((await pin(id)).statusCode).toBe(200);
    const fourth = await pin('m4');
    expect(fourth.statusCode).toBe(409);
    expect(fourth.body.message).toMatch(/3 quests at a time/);
    expect(await pinnedIds()).toEqual(['m1', 'm2', 'm3']);
  });

  it('frees a slot when one is unpinned, and re-pinning one already pinned is fine', async () => {
    for (const id of ['m1', 'm2', 'm3']) await pin(id);
    expect((await pin('m1')).statusCode).toBe(200); // already pinned — no change
    await pin('m2', false);
    expect((await pin('m4')).statusCode).toBe(200);
    expect(await pinnedIds()).toEqual(['m1', 'm3', 'm4']);
  });

  it('does not count finished quests towards the limit', async () => {
    for (const id of ['m1', 'm2', 'm3']) await pin(id);
    await db.update(teacherMissionProgress).set({ status: 'COMPLETED' })
      .where(and(eq(teacherMissionProgress.teacherId, TEACHER), eq(teacherMissionProgress.missionId, 'm1')));
    expect((await pin('m4')).statusCode).toBe(200);
  });
});
