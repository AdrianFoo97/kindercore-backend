import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { pool } from '../../db/client.js';
import { leads, packages, students, studentEnrollments } from '../../db/schema.js';
import { computeMonthlyRevenue, isActiveInMonth, studentMonthlyPrice } from '../../services/revenue.service.js';
import { resetTables } from './testDb.js';
import { seedPackages, seedStudent, PKG } from '../fixtures/students.js';

// Monthly tuition revenue (Students module) — feeds Finance, profit-share
// pools and bonuses. Real service, real (test) DB, fixtures from
// ../fixtures/students.ts. "Today" is pinned to 15 Jun 2026, so 2025 is a
// fully past year and 2026 has past, current and forecast months.

const JAN = 0, FEB = 1, MAR = 2, APR = 3, MAY = 4, JUN = 5, JUL = 6;

beforeEach(async () => {
  await resetTables(studentEnrollments, students, leads, packages);
  await seedPackages();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await pool.end();
});

const month = async (year: number, m: number) => (await computeMonthlyRevenue(year)).months[m];

describe('Students — monthly tuition revenue', () => {
  it('counts an enrolled student\'s package price every month they are enrolled', async () => {
    await seedStudent({ enrollments: [{ start: '2025-01-01', pkg: PKG.standard }] });
    const r = await computeMonthlyRevenue(2025);
    expect(r.months.every(m => m.revenue === 1000 && m.studentCount === 1)).toBe(true);
  });

  it('uses the custom fee when a student\'s fee has been overridden', async () => {
    await seedStudent({ enrollments: [{ start: '2025-01-01', pkg: PKG.premium, fee: 800, overridden: true }] });
    expect((await month(2025, MAR)).revenue).toBe(800);
  });

  it('adds up every enrolled student', async () => {
    await seedStudent({ enrollments: [{ start: '2025-01-01', pkg: PKG.standard }] });
    await seedStudent({ enrollments: [{ start: '2025-01-01', pkg: PKG.premium }] });
    expect(await month(2025, MAR)).toMatchObject({ revenue: 2500, studentCount: 2 });
  });

  it('starts counting a mid-month joiner from the month they join', async () => {
    await seedStudent({ enrollments: [{ start: '2025-03-15' }] });
    expect((await month(2025, FEB)).revenue).toBe(0);
    expect((await month(2025, MAR)).revenue).toBe(1000);
  });

  it('still counts the month a student withdraws in, but not the month after', async () => {
    await seedStudent({ enrollments: [{ start: '2025-01-01', end: '2025-06-10' }] });
    expect((await month(2025, JUN)).revenue).toBe(1000);
    expect((await month(2025, JUL)).revenue).toBe(0);
  });

  it('charges the new package for the month a student switches package mid-month', async () => {
    await seedStudent({
      enrollments: [
        { start: '2025-01-01', end: '2025-04-15', pkg: PKG.standard },
        { start: '2025-04-15', pkg: PKG.premium },
      ],
    });
    expect((await month(2025, MAR)).revenue).toBe(1000);
    expect((await month(2025, APR)).revenue).toBe(1500);
    expect((await month(2025, APR)).studentCount).toBe(1); // one child, not two
  });

  it('stops counting a child for the whole year they turn 7', async () => {
    await seedStudent({ dob: '2018-09-01', enrollments: [{ start: '2025-01-01' }] }); // turns 7 in 2025
    await seedStudent({ dob: '2019-09-01', enrollments: [{ start: '2025-01-01' }] }); // turns 6
    expect(await month(2025, JAN)).toMatchObject({ revenue: 1000, studentCount: 1 });
  });

  it('keeps a past month\'s revenue after a withdrawal, but drops the child from forecast months', async () => {
    await seedStudent({ enrollments: [{ start: '2026-01-01', end: '2026-05-20' }] });
    expect((await month(2026, MAY)).revenue).toBe(1000); // past month — happened
    const jul = await month(2026, JUL);
    expect(jul.isForecast).toBe(true);
    expect(jul.revenue).toBe(0); // future — they've left
  });

  it('marks months after the current one as forecast', async () => {
    const r = await computeMonthlyRevenue(2026);
    expect(r.currentMonthIdx).toBe(JUN);
    expect(r.months[JUN].isForecast).toBe(false);
    expect(r.months[JUL].isForecast).toBe(true);
  });

  it('reports zero for a year with no enrolments', async () => {
    const r = await computeMonthlyRevenue(2025);
    expect(r.months.every(m => m.revenue === 0 && m.studentCount === 0)).toBe(true);
  });
});

describe('Students — who counts as enrolled in a month (isActiveInMonth)', () => {
  const kid = (o: Record<string, unknown>) => ({ startDate: '2025-01-01', withdrawnAt: null, studentChildDob: '2021-01-01', ...o });

  it('counts a student enrolled before the month', () => {
    expect(isActiveInMonth(kid({}), 2025, MAR)).toBe(true);
  });

  it('does not count a student who starts after the month ends', () => {
    expect(isActiveInMonth(kid({ startDate: '2025-04-01' }), 2025, MAR)).toBe(false);
  });

  it('does not count a student who withdrew before the month began', () => {
    expect(isActiveInMonth(kid({ withdrawnAt: '2025-02-20' }), 2025, MAR)).toBe(false);
  });

  it('counts a student with no start date as not enrolled', () => {
    expect(isActiveInMonth(kid({ startDate: null }), 2025, MAR)).toBe(false);
  });
});

describe('Students — monthly fee (studentMonthlyPrice)', () => {
  it('uses the package price normally', () => {
    expect(studentMonthlyPrice({ feeOverridden: false, monthlyFee: 700, packagePrice: 1000 })).toBe(1000);
  });

  it('uses the custom fee when overridden — even if it is zero (a scholarship)', () => {
    expect(studentMonthlyPrice({ feeOverridden: true, monthlyFee: 0, packagePrice: 1000 })).toBe(0);
  });
});
