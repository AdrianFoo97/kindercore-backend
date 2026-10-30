import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { scheduleBlocks, classrooms } from '../../db/schema.js';
import { checkConflicts, createBlock } from '../../controllers/planner.controller.js';
import { resetTables } from './testDb.js';
import { req, res } from './http.js';

// Tools → Planner: the timetable must never put one teacher, or one
// classroom, in two places at once. Real handlers, real (test) DB.
// Existing block: Monday 9:00–10:00, teacher Tina, Room A.

const NOW = new Date('2026-01-01T00:00:00Z');
const WEEK = '2026-06-01';
const MON = 0, TUE = 1;
const at = (h: number, m = 0) => h * 60 + m;

beforeEach(async () => {
  await resetTables(scheduleBlocks, classrooms);
  await db.insert(classrooms).values([
    { id: 'room-a', name: 'Room A', createdAt: NOW, updatedAt: NOW },
    { id: 'room-b', name: 'Room B', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(scheduleBlocks).values({
    id: 'blk-1', weekDate: new Date(WEEK), dayOfWeek: MON, startMinute: at(9), durationMinutes: 60,
    teacherId: 't-tina', classroomId: 'room-a', createdAt: NOW, updatedAt: NOW,
  });
});
afterAll(async () => {
  await pool.end();
});

async function clashes(o: { teacherId?: string | null; classroomId?: string | null; day?: number; start: number; mins: number; week?: string; exclude?: string }) {
  const r = res();
  await checkConflicts(req({
    teacherId: o.teacherId ?? null, classroomId: o.classroomId ?? null, dayOfWeek: o.day ?? MON,
    startMinute: o.start, durationMinutes: o.mins, weekDate: o.week ?? WEEK, excludeBlockId: o.exclude,
  }), r);
  return (r.body as { id: string }[]).map(b => b.id);
}

describe('Tools — planner double-booking check', () => {
  it('flags the same teacher booked at an overlapping time', async () => {
    expect(await clashes({ teacherId: 't-tina', classroomId: 'room-b', start: at(9, 30), mins: 60 })).toEqual(['blk-1']);
  });

  it('flags the same classroom booked at an overlapping time, even with a different teacher', async () => {
    expect(await clashes({ teacherId: 't-other', classroomId: 'room-a', start: at(9, 30), mins: 30 })).toEqual(['blk-1']);
  });

  it('allows back-to-back sessions (one ends exactly when the next starts)', async () => {
    expect(await clashes({ teacherId: 't-tina', classroomId: 'room-a', start: at(10), mins: 60 })).toEqual([]);
  });

  it('allows a different teacher in a different room at the same time', async () => {
    expect(await clashes({ teacherId: 't-other', classroomId: 'room-b', start: at(9), mins: 60 })).toEqual([]);
  });

  it('only compares the same day of the same week', async () => {
    expect(await clashes({ teacherId: 't-tina', day: TUE, start: at(9), mins: 60 })).toEqual([]);
    expect(await clashes({ teacherId: 't-tina', week: '2026-06-08', start: at(9), mins: 60 })).toEqual([]);
  });

  it('flags a booking that sits completely inside an existing one', async () => {
    expect(await clashes({ teacherId: 't-tina', start: at(9, 15), mins: 15 })).toEqual(['blk-1']);
  });

  it('ignores the block being edited itself', async () => {
    expect(await clashes({ teacherId: 't-tina', start: at(9), mins: 90, exclude: 'blk-1' })).toEqual([]);
  });

  it('refuses to create a block that double-books a teacher', async () => {
    const r = res();
    await createBlock(req({ weekDate: WEEK, dayOfWeek: MON, startMinute: at(9, 30), durationMinutes: 30, teacherId: 't-tina' }), r);
    expect(r.statusCode).toBe(409);
    expect((await db.select().from(scheduleBlocks)).length).toBe(1);
  });
});
