import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { pool, db } from '../../db/client.js';
import {
  teachers, positions, departments, levelIncentives, teacherAllowances, careerRecords, systemSettings, allowanceTypes,
} from '../../db/schema.js';
import { computeMonthlyPayroll, isTeacherActiveInMonth } from '../../services/payroll.service.js';
import { resetTables } from './testDb.js';

// Monthly payroll (HR module) — staff cost behind Finance, Analysis, profit
// and the profit-share pools. Real service, real (test) DB. "Today" is
// pinned to 15 Jun 2026, so 2025 is fully past. Employer-contribution
// settings are left unset, so Malaysia's defaults apply: EPF 13% (≤ RM 5,000)
// / 12% above, SOCSO 1.75% and EIS 0.4% capped at RM 4,000.

const NOW = new Date('2024-01-01T00:00:00Z');
const MAR = 2, MAY = 4, JUN = 5, JUL = 6, FEB = 1;

/** A teacher with employer contributions OFF unless asked — keeps salary maths readable. */
const teacher = (id: string, o: Partial<typeof teachers.$inferInsert> = {}): typeof teachers.$inferInsert => ({
  id, name: id, color: '#7c3aed', createdAt: NOW, updatedAt: NOW,
  hasEpf: false, hasSocso: false, hasEis: false, ...o,
});

beforeEach(async () => {
  await resetTables(careerRecords, teacherAllowances, allowanceTypes, levelIncentives, teachers, positions, departments, systemSettings);
  await db.insert(departments).values([
    { departmentId: 'D-TEACH', name: 'Teaching', sortOrder: 0, createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(positions).values([
    { positionId: 'P-T', name: 'Teacher', basicSalary: 2000, departmentId: 'D-TEACH', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(levelIncentives).values([
    { id: 'li-2', positionId: 'P-T', level: 2, amount: 300, updatedAt: NOW },
  ]);
  await db.insert(allowanceTypes).values([{ id: 'at-transport', name: 'Transport', createdAt: NOW }]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await pool.end();
});

const month = async (m: number, year = 2025) => (await computeMonthlyPayroll(year)).months[m];

describe('HR — monthly payroll', () => {
  it('pays a position-based salary as basic + level incentive + allowances', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'formula', positionId: 'P-T', level: 2 }));
    await db.insert(teacherAllowances).values({ id: 'ta-1', teacherId: 't1', allowanceTypeId: 'at-transport', amount: 150, updatedAt: NOW });
    expect((await month(MAR)).staffCost).toBe(2000 + 300 + 150);
  });

  it('pays a fixed salary plus allowances, ignoring the position scale', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 3100, positionId: 'P-T', level: 2 }));
    expect((await month(MAR)).staffCost).toBe(3100);
  });

  it('pays an hourly rate from working hours, taking an hour off for lunch on long days', async () => {
    // 8:00–17:00 = 9h → 8 paid hours, 5 days a week, 4.33 weeks a month.
    await db.insert(teachers).values(teacher('t1', {
      salaryType: 'hourly', hourlyRate: 20, workStartMinute: 480, workEndMinute: 1020, workDays: [0, 1, 2, 3, 4],
    }));
    expect((await month(MAR)).staffCost).toBeCloseTo(20 * 8 * 5 * 4.33, 2);
  });

  it('applies a promotion from the month it takes effect, not before', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'formula', positionId: 'P-T', level: 2 }));
    await db.insert(careerRecords).values([
      { id: 'cr-1', teacherId: 't1', positionId: 'P-T', level: 0, effectiveDate: new Date('2024-01-01'), createdAt: NOW },
      { id: 'cr-2', teacherId: 't1', positionId: 'P-T', level: 2, effectiveDate: new Date('2025-06-01'), createdAt: NOW },
    ]);
    expect((await month(MAY)).staffCost).toBe(2000);
    expect((await month(JUN)).staffCost).toBe(2300);
  });

  it('counts a new joiner from the month they join', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 2500, createdAt: new Date(2025, 2, 10) }));
    expect(await month(FEB)).toMatchObject({ staffCost: 0, teacherCount: 0 });
    expect(await month(MAR)).toMatchObject({ staffCost: 2500, teacherCount: 1 });
  });

  it('still pays the month someone resigns in, but not after', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 2500, isActive: false, resignedAt: new Date(2025, 5, 12) }));
    expect((await month(JUN)).teacherCount).toBe(1);
    expect((await month(JUL)).teacherCount).toBe(0);
  });

  it('never counts a deleted record (inactive with no resignation date)', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 2500, isActive: false, resignedAt: null }));
    expect(await month(MAR)).toMatchObject({ staffCost: 0, teacherCount: 0 });
  });

  it('adds employer EPF 13%, SOCSO 1.75% and EIS 0.4% on a salary up to RM 5,000', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 3000, hasEpf: true, hasSocso: true, hasEis: true }));
    expect((await month(MAR)).employerContributions).toBeCloseTo(3000 * 0.13 + 3000 * 0.0175 + 3000 * 0.004, 2);
  });

  it('uses EPF 12% above RM 5,000 and caps SOCSO and EIS at RM 4,000', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 6000, hasEpf: true, hasSocso: true, hasEis: true }));
    expect((await month(MAR)).employerContributions).toBeCloseTo(6000 * 0.12 + 4000 * 0.0175 + 4000 * 0.004, 2);
  });

  it('skips contributions a teacher is exempt from', async () => {
    await db.insert(teachers).values(teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 3000, hasEpf: true }));
    expect((await month(MAR)).employerContributions).toBeCloseTo(390, 2); // EPF only
  });

  it('keeps staff marked "exclude from staff cost" out of the total, but in the headcount', async () => {
    await db.insert(teachers).values([
      teacher('t1', { salaryType: 'fixed', fixedSalaryAmount: 2500 }),
      teacher('t2', { salaryType: 'fixed', fixedSalaryAmount: 4000, excludeFromStaffCost: true }),
    ]);
    expect(await month(MAR)).toMatchObject({ staffCost: 2500, excludedStaffCost: 4000, teacherCount: 2 });
  });

  it('splits staff cost by department, with no-position staff under "Unassigned"', async () => {
    await db.insert(teachers).values([
      teacher('t1', { salaryType: 'formula', positionId: 'P-T', level: 0 }),
      teacher('t2', { salaryType: 'fixed', fixedSalaryAmount: 1800 }),
    ]);
    expect((await month(MAR)).byDepartment).toEqual([
      { departmentId: 'D-TEACH', departmentName: 'Teaching', staffCost: 2000, teacherCount: 1 },
      { departmentId: 'UNASSIGNED', departmentName: 'Unassigned', staffCost: 1800, teacherCount: 1 },
    ]);
  });
});

describe('HR — who is on payroll in a month (isTeacherActiveInMonth)', () => {
  const start = new Date(2025, 2, 1), end = new Date(2025, 2, 31, 23, 59, 59);

  it('counts someone who joined on the last day of the month', () => {
    expect(isTeacherActiveInMonth({ isActive: true, createdAt: new Date(2025, 2, 31), resignedAt: null }, start, end)).toBe(true);
  });

  it('counts someone who resigned on the first day of the month', () => {
    expect(isTeacherActiveInMonth({ isActive: false, createdAt: null, resignedAt: new Date(2025, 2, 1) }, start, end)).toBe(true);
  });
});
