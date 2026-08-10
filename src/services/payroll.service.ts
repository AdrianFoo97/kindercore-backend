import { db } from '../db/client.js';
import { positions, levelIncentives, teachers, teacherAllowances, careerRecords, systemSettings, departments } from '../db/schema.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * `resignedAt` is the source of truth for when a teacher stops counting.
 * `isActive` is only meaningful as a soft-delete flag (isActive=false with no
 * resignedAt means "deleted, never should have existed").
 *
 * A teacher counts for a month iff:
 *  - They are not soft-deleted.
 *  - They joined on or before end-of-month.
 *  - They did not resign before start-of-month (mid-month resignations still
 *    count for that month's payroll).
 */
export function isTeacherActiveInMonth(
  t: { isActive: boolean; createdAt: Date | string | null; resignedAt: Date | string | null },
  startOfMonth: Date,
  endOfMonth: Date,
): boolean {
  if (!t.isActive && !t.resignedAt) return false;
  const joined = t.createdAt ? new Date(t.createdAt) : null;
  if (joined && joined > endOfMonth) return false;
  const resigned = t.resignedAt ? new Date(t.resignedAt) : null;
  if (resigned && resigned < startOfMonth) return false;
  return true;
}

export interface MonthlyPayrollEntry {
  monthIdx: number;
  month: string;
  staffCost: number;
  employerContributions: number;
  teacherCount: number;
  isForecast: boolean;
  /** Salary + employer contributions for teachers flagged
   *  excludeFromStaffCost — still real headcount, just left out of the
   *  Staff Cost total (and therefore profit/margin). */
  excludedStaffCost: number;
  /** staffCost split by the teacher's effective department that month, sorted
   *  by Department.sortOrder. Teachers with no resolvable position/department
   *  land in a trailing "Unassigned" bucket. Excludes excludeFromStaffCost
   *  teachers, same as staffCost itself. */
  byDepartment: { departmentId: string; departmentName: string; staffCost: number; teacherCount: number }[];
}

export interface MonthlyPayrollResult {
  year: number;
  currentMonthIdx: number;
  months: MonthlyPayrollEntry[];
}

export async function computeMonthlyPayroll(year: number): Promise<MonthlyPayrollResult> {
  const [allTeachers, allPositions, allIncentives, allAllowances, allCareerRecords, settingRows, allDepartments] = await Promise.all([
    db.select().from(teachers),
    db.select().from(positions),
    db.select().from(levelIncentives),
    db.select().from(teacherAllowances),
    db.select().from(careerRecords),
    db.select().from(systemSettings),
    db.select().from(departments),
  ]);

  const deptMap = new Map(allDepartments.map(d => [d.departmentId, d]));
  const sortedDeptIds = [...allDepartments].sort((a, b) => a.sortOrder - b.sortOrder).map(d => d.departmentId);
  const UNASSIGNED = 'UNASSIGNED';

  // Parse employer contribution settings
  const settingMap = new Map(settingRows.map(r => [r.key, r.value]));
  const getSetting = (key: string, def: number | boolean) => { const v = settingMap.get(key); return v !== undefined && v !== null ? v : def; };
  const epfEnabled    = getSetting('epf_enabled', true) as boolean;
  const epfRateBelow  = Number(getSetting('epf_rate_below', 13));
  const epfRateAbove  = Number(getSetting('epf_rate_above', 12));
  const epfThreshold  = Number(getSetting('epf_threshold', 5000));
  const socsoEnabled  = getSetting('socso_enabled', true) as boolean;
  const socsoRate     = Number(getSetting('socso_rate', 1.75));
  const socsoCeiling  = Number(getSetting('socso_ceiling', 4000));
  const eisEnabled    = getSetting('eis_enabled', true) as boolean;
  const eisRate       = Number(getSetting('eis_rate', 0.4));
  const eisCeiling    = Number(getSetting('eis_ceiling', 4000));

  const posMap = new Map(allPositions.map(p => [p.positionId, p]));
  const incMap = new Map(allIncentives.map(i => [`${i.positionId}|${i.level}`, i.amount]));

  const teacherAllowanceMap = new Map<string, number>();
  for (const a of allAllowances) {
    teacherAllowanceMap.set(a.teacherId, (teacherAllowanceMap.get(a.teacherId) ?? 0) + a.amount);
  }

  // Career records grouped by teacher, sorted effectiveDate DESC for point-in-time lookup
  const careerByTeacher = new Map<string, typeof allCareerRecords>();
  for (const rec of allCareerRecords) {
    const list = careerByTeacher.get(rec.teacherId) ?? [];
    list.push(rec);
    careerByTeacher.set(rec.teacherId, list);
  }
  for (const list of careerByTeacher.values()) {
    list.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
  }

  const getEffectiveCareer = (teacherId: string, asOf: Date): { positionId: string; level: number } | null => {
    const records = careerByTeacher.get(teacherId);
    if (!records) return null;
    for (const rec of records) {
      if (new Date(rec.effectiveDate) <= asOf) return { positionId: rec.positionId, level: rec.level };
    }
    return null;
  };

  const computeTeacherSalary = (t: typeof allTeachers[0], asOf: Date): number => {
    const totalAllowances = teacherAllowanceMap.get(t.id) ?? 0;
    const salaryType = t.salaryType ?? (t.isFixedSalary ? 'fixed' : 'formula');

    if (salaryType === 'hourly' && t.hourlyRate != null) {
      const rawHoursPerDay = (t.workStartMinute != null && t.workEndMinute != null)
        ? (t.workEndMinute - t.workStartMinute) / 60 : 0;
      const hoursPerDay = rawHoursPerDay >= 6 ? rawHoursPerDay - 1 : rawHoursPerDay;
      const daysPerWeek = t.workDays ? (t.workDays as number[]).length : 0;
      const monthlyHours = hoursPerDay * daysPerWeek * 4.33;
      return (t.hourlyRate * monthlyHours) + totalAllowances;
    }
    if (salaryType === 'fixed' && t.fixedSalaryAmount != null) {
      return t.fixedSalaryAmount + totalAllowances;
    }
    // Formula — career record effective at asOf, fallback to current position/level
    const career = getEffectiveCareer(t.id, asOf);
    const effectivePositionId = career?.positionId ?? t.positionId;
    const effectiveLevel = career?.level ?? t.level ?? 0;
    if (effectivePositionId) {
      const pos = posMap.get(effectivePositionId);
      const basic = pos?.basicSalary ?? 0;
      const levelInc = incMap.get(`${effectivePositionId}|${effectiveLevel}`) ?? 0;
      return basic + levelInc + totalAllowances;
    }
    return 0;
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  const months: MonthlyPayrollEntry[] = MONTHS.map((month, i) => {
    const endOfMonth = new Date(year, i + 1, 0, 23, 59, 59);
    const startOfMonth = new Date(year, i, 1, 0, 0, 0);
    const isCurrent = i === currentMonthIdx;
    const isForecast = year > currentYear || (year === currentYear && i > currentMonthIdx);
    const activeTeachers = allTeachers.filter(t => isTeacherActiveInMonth(t, startOfMonth, endOfMonth));
    // Current/forecast months: use `now` so the salary matches the Staff Analysis
    // snapshot (career records scheduled later in the month aren't applied yet).
    // Past months: use end-of-month so historical promotions are honoured.
    const salaryAsOf = (isCurrent || isForecast) ? now : endOfMonth;
    let staffCost = 0;
    let employerContributions = 0;
    let excludedStaffCost = 0;
    const deptTotals = new Map<string, { staffCost: number; teacherCount: number }>();
    for (const t of activeTeachers) {
      const salary = computeTeacherSalary(t, salaryAsOf);
      let contributions = 0;
      if (epfEnabled   && (t as any).hasEpf   !== false) contributions += salary <= epfThreshold ? salary * epfRateBelow / 100 : salary * epfRateAbove / 100;
      if (socsoEnabled && (t as any).hasSocso !== false) contributions += Math.min(salary, socsoCeiling) * socsoRate / 100;
      if (eisEnabled   && (t as any).hasEis   !== false) contributions += Math.min(salary, eisCeiling)   * eisRate   / 100;
      // excludeFromStaffCost pulls this teacher's salary + its employer
      // contributions out of the Staff Cost total entirely — distinct from
      // excludeFromProfitShare, which only affects the profit-share pool.
      // They're still active headcount (teacherCount below), just not
      // counted as a cost.
      if ((t as any).excludeFromStaffCost) {
        excludedStaffCost += salary + contributions;
      } else {
        staffCost += salary;
        employerContributions += contributions;
        // Same effective-position resolution computeTeacherSalary uses for
        // the formula branch — career record as of this month, falling back
        // to the teacher's current position. Applied regardless of salary
        // type so hourly/fixed-salary teachers still land in their department.
        const career = getEffectiveCareer(t.id, salaryAsOf);
        const effectivePositionId = career?.positionId ?? t.positionId;
        const pos = effectivePositionId ? posMap.get(effectivePositionId) : undefined;
        const deptId = (pos?.departmentId && deptMap.has(pos.departmentId)) ? pos.departmentId : UNASSIGNED;
        // salary only (no employer contributions) — matches the `staffCost`
        // total this same loop accumulates, which is what getPayrollByMonth
        // exposes as the chart's bar total.
        const bucket = deptTotals.get(deptId) ?? { staffCost: 0, teacherCount: 0 };
        bucket.staffCost += salary;
        bucket.teacherCount += 1;
        deptTotals.set(deptId, bucket);
      }
    }
    const byDepartment = [
      ...sortedDeptIds
        .filter(id => deptTotals.has(id))
        .map(id => ({ departmentId: id, departmentName: deptMap.get(id)!.name, ...deptTotals.get(id)! })),
      ...(deptTotals.has(UNASSIGNED)
        ? [{ departmentId: UNASSIGNED, departmentName: 'Unassigned', ...deptTotals.get(UNASSIGNED)! }]
        : []),
    ];
    return { monthIdx: i, month, staffCost, employerContributions, teacherCount: activeTeachers.length, isForecast, excludedStaffCost, byDepartment };
  });

  return { year, currentMonthIdx, months };
}

// ── Teacher weights by month ─────────────────────────────────────────────────

export interface TeacherWeightMonth {
  monthIdx: number;
  positionId: string | null;
  positionCode: string | null;
  positionName: string | null;
  level: number;
  /** Raw position rank (Position.titleWeight). */
  baseWeight: number;
  /** Interpolated level contribution: (level / maxLevel) × gap-to-next-rank. */
  levelWeight: number;
  /** Weight before the active-days proration: (baseWeight + levelWeight), halved if part-time. */
  fullWeight: number;
  /** Final profit-share weight for the month = fullWeight × (activeDays / daysInMonth). */
  weight: number;
  /** Days the teacher was on payroll this month (handles mid-month join / resignation). */
  activeDays: number;
  /** Calendar days in the month (28–31). */
  daysInMonth: number;
  /** activeDays / daysInMonth, in [0, 1]. */
  activeDayRatio: number;
  isPartTime: boolean;
  isActive: boolean;
}

export interface TeacherWeightRow {
  teacherId: string;
  teacherName: string;
  color: string;
  employmentType: string;
  months: TeacherWeightMonth[];
  averageWeight: number;
  isOverride: boolean;
}

export interface TeacherWeightsResult {
  year: number;
  currentMonthIdx: number;
  teachers: TeacherWeightRow[];
}

/**
 * Compute each teacher's title weight for each month of a year, honouring
 * CareerRecord history so a mid-year promotion is reflected correctly.
 * Inactive months (before join date or after resignation) return weight 0 and
 * isActive=false so the frontend can dim the cell.
 */
export async function computeTeacherWeightsByMonth(year: number): Promise<TeacherWeightsResult> {
  const [allTeachers, allPositions, allCareerRecords] = await Promise.all([
    db.select().from(teachers),
    db.select().from(positions),
    db.select().from(careerRecords),
  ]);

  const posMap = new Map(allPositions.map(p => [p.positionId, p]));

  // Sort positions by rank so we can find each position's "gap to next rank"
  // for the interpolated level weight formula (matches frontend profit-share).
  const sortedPositions = [...allPositions].sort((a, b) => a.titleWeight - b.titleWeight);

  const careerByTeacher = new Map<string, typeof allCareerRecords>();
  for (const rec of allCareerRecords) {
    const list = careerByTeacher.get(rec.teacherId) ?? [];
    list.push(rec);
    careerByTeacher.set(rec.teacherId, list);
  }
  for (const list of careerByTeacher.values()) {
    list.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
  }

  const getEffectiveCareer = (teacherId: string, asOf: Date): { positionId: string; level: number } | null => {
    const records = careerByTeacher.get(teacherId);
    if (!records) return null;
    for (const rec of records) {
      if (new Date(rec.effectiveDate) <= asOf) return { positionId: rec.positionId, level: rec.level };
    }
    return null;
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  const eligibleTeachers = allTeachers.filter(t => !t.excludeFromProfitShare);

  const rows: TeacherWeightRow[] = eligibleTeachers.map(t => {
    const isPartTime = t.employmentType === 'part-time';
    const months: TeacherWeightMonth[] = Array.from({ length: 12 }).map((_, i) => {
      const endOfMonth = new Date(year, i + 1, 0, 23, 59, 59);
      const startOfMonth = new Date(year, i, 1, 0, 0, 0);
      const joined = t.createdAt ? new Date(t.createdAt) : null;
      const resigned = t.resignedAt ? new Date(t.resignedAt) : null;
      const isActive = !(joined && joined > endOfMonth) && !(resigned && resigned < startOfMonth);
      const daysInMonth = endOfMonth.getDate();
      if (!isActive) {
        return {
          monthIdx: i, positionId: null, positionCode: null, positionName: null,
          level: 0, baseWeight: 0, levelWeight: 0, fullWeight: 0, weight: 0,
          activeDays: 0, daysInMonth, activeDayRatio: 0,
          isPartTime, isActive: false,
        };
      }
      const career = getEffectiveCareer(t.id, endOfMonth);
      // If the teacher has career records but none are effective yet for this month,
      // treat as unassigned (no fallback to current position) so early months show —.
      const teacherHasAnyRecord = careerByTeacher.has(t.id);
      const effectivePositionId = career ? career.positionId : (teacherHasAnyRecord ? null : (t.positionId ?? null));
      const effectiveLevel = career ? career.level : (teacherHasAnyRecord ? 0 : (t.level ?? 0));
      const pos = effectivePositionId ? posMap.get(effectivePositionId) : undefined;
      const baseWeight = pos?.titleWeight ?? 0;
      const maxLevel = pos?.maxLevel ?? 0;

      // Interpolated level weight: (level / maxLevel) × gap-to-next-rank.
      // If there's no higher-ranked position, use a gap of 1 as a fallback.
      let levelWeight = 0;
      if (maxLevel > 0 && baseWeight > 0) {
        const nextPos = sortedPositions.find(p => p.titleWeight > baseWeight);
        const gap = nextPos ? (nextPos.titleWeight - baseWeight) : 1;
        levelWeight = (effectiveLevel / maxLevel) * gap;
      }

      let fullWeight = baseWeight + levelWeight;
      if (isPartTime) fullWeight = fullWeight / 2;

      // Override: use custom weight if the teacher has set a manual override
      if (t.overrideProfitShareWeight && t.customProfitShareWeight != null) {
        fullWeight = t.customProfitShareWeight;
      }

      // Pro-rate by active days in the month — handles partial months at
      // join and resignation. A teacher who started on the 20th of a 31-day
      // month earns 12/31 of the full weight for that month.
      const joinDay = joined && joined.getFullYear() === year && joined.getMonth() === i
        ? joined.getDate() : 1;
      const leaveDay = resigned && resigned.getFullYear() === year && resigned.getMonth() === i
        ? resigned.getDate() : daysInMonth;
      const activeDays = Math.max(0, leaveDay - joinDay + 1);
      const activeDayRatio = activeDays / daysInMonth;
      const weight = fullWeight * activeDayRatio;

      return {
        monthIdx: i,
        positionId: effectivePositionId,
        positionCode: pos?.positionId ?? null,
        positionName: pos?.name ?? null,
        level: effectiveLevel,
        baseWeight,
        levelWeight,
        fullWeight,
        weight,
        activeDays,
        daysInMonth,
        activeDayRatio,
        isPartTime,
        isActive: true,
      };
    });
    const activeMonths = months.filter(m => m.isActive);
    const averageWeight = activeMonths.length > 0
      ? activeMonths.reduce((s, m) => s + m.weight, 0) / activeMonths.length
      : 0;
    return {
      teacherId: t.id,
      teacherName: t.name,
      color: t.color ?? '#94a3b8',
      employmentType: t.employmentType ?? 'full-time',
      months,
      averageWeight,
      isOverride: !!(t.overrideProfitShareWeight && t.customProfitShareWeight != null),
    };
  });

  rows.sort((a, b) => b.averageWeight - a.averageWeight || a.teacherName.localeCompare(b.teacherName));

  return { year, currentMonthIdx, teachers: rows };
}
