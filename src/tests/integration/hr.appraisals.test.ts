import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { positions, teacherAppraisals, teachers } from '../../db/schema.js';
import { listAppraisalOverview, upsertAppraisal } from '../../controllers/teacher-appraisals.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { positionRows } from '../fixtures/permissions.js';

// HR → Appraisals: every current staff member's appraisal for a month, and
// their 12-month average. Months are 0–11 (10 = November).

const NOW = new Date('2026-01-01T00:00:00Z');
const staff = (id: string, name: string, extra: Partial<typeof teachers.$inferInsert> = {}): typeof teachers.$inferInsert =>
  ({ id, name, color: '#7c3aed', positionId: 'P-CT', createdAt: NOW, updatedAt: NOW, ...extra });
const appraisal = (teacherId: string, year: number, month: number, score: number) =>
  ({ id: `${teacherId}-${year}-${month}`, teacherId, year, month, score, createdAt: NOW, updatedAt: NOW });

beforeEach(async () => {
  await resetTables(teacherAppraisals, teachers, positions);
  await db.insert(positions).values(positionRows);
});
afterAll(async () => { await pool.end(); });

async function overview(year: number, month: number) {
  const r = res();
  const request = reqWith({});
  (request as unknown as { query: Record<string, string> }).query = { year: String(year), month: String(month) };
  await listAppraisalOverview(request, r);
  return r.body as { staff: { teacherId: string; positionName: string | null; appraisal: { score: number } | null; twelveMonth: { average: number | null; recordCount: number } }[] };
}

describe('HR — appraisals overview', () => {
  it('lists every current staff member for the month, showing who is appraised and who is due', async () => {
    await db.insert(teachers).values([staff('t-ana', 'Ana'), staff('t-ben', 'Ben')]);
    await db.insert(teacherAppraisals).values(appraisal('t-ana', 2026, 10, 82));
    const { staff: rows } = await overview(2026, 10);
    expect(rows.map(r => [r.teacherId, r.appraisal?.score ?? 'due'])).toEqual([['t-ana', 82], ['t-ben', 'due']]);
    expect(rows[0].positionName).toBe('Class Teacher');
  });

  it('includes staff whose position is not on the career track', async () => {
    await db.insert(teachers).values(staff('t-helper', 'Helper Hana', { positionId: 'P-NONE' }));
    const { staff: rows } = await overview(2026, 10);
    expect(rows.map(r => r.teacherId)).toEqual(['t-helper']);
  });

  it('leaves out people who had left before the month, or joined after it', async () => {
    await db.insert(teachers).values([
      staff('t-left', 'Left in Sept', { isActive: false, resignedAt: new Date('2026-09-30T00:00:00Z') }),
      staff('t-leaving', 'Leaving mid-Nov', { resignedAt: new Date('2026-11-15T00:00:00Z') }),
      staff('t-new', 'Joins in Dec', { createdAt: new Date('2026-12-01T00:00:00Z') }),
      staff('t-deleted', 'Removed record', { isActive: false }),
    ]);
    const { staff: rows } = await overview(2026, 10);
    expect(rows.map(r => r.teacherId)).toEqual(['t-leaving']);
  });

  it('shows each person\'s average over the 12 months up to that month', async () => {
    await db.insert(teachers).values(staff('t-ana', 'Ana'));
    await db.insert(teacherAppraisals).values([
      appraisal('t-ana', 2026, 10, 80), appraisal('t-ana', 2026, 0, 70), appraisal('t-ana', 2025, 9, 10), // Oct 2025: 13 months back
    ]);
    const { staff: [ana] } = await overview(2026, 10);
    expect(ana.twelveMonth).toMatchObject({ average: 75, recordCount: 2 });
  });

  it('shows each person\'s previous mark, to compare against when recording the month', async () => {
    await db.insert(teachers).values([staff('t-ana', 'Ana'), staff('t-ben', 'Ben')]);
    await db.insert(teacherAppraisals).values([appraisal('t-ana', 2026, 8, 68), appraisal('t-ana', 2026, 5, 90)]);
    const { staff: [ana, ben] } = await overview(2026, 10);
    expect((ana as unknown as { previous: unknown }).previous).toEqual({ year: 2026, month: 8, score: 68 });
    expect((ben as unknown as { previous: unknown }).previous).toBeNull();
  });

  it('records an appraisal for any staff member, and replaces it when the same month is entered again', async () => {
    await db.insert(teachers).values(staff('t-helper', 'Helper Hana', { positionId: 'P-NONE' }));
    const record = async (score: number) => {
      const r = res();
      await upsertAppraisal(reqWith({ params: { teacherId: 't-helper' }, body: { year: 2026, month: 10, score, evaluatedBy: 'Principal' } }), r);
      return r;
    };
    expect((await record(60)).body).toMatchObject({ score: 60 });
    expect((await record(85)).body).toMatchObject({ score: 85 });
    expect(await db.select().from(teacherAppraisals)).toHaveLength(1);
  });
});
