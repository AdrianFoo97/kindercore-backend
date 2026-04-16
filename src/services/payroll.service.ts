import { db } from '../db/client.js';
import { positions, levelIncentives, teachers, teacherAllowances, careerRecords } from '../db/schema.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface MonthlyPayrollEntry {
  monthIdx: number;
  month: string;
  staffCost: number;
  teacherCount: number;
  isForecast: boolean;
}

export interface MonthlyPayrollResult {
  year: number;
  currentMonthIdx: number;
  months: MonthlyPayrollEntry[];
}

export async function computeMonthlyPayroll(year: number): Promise<MonthlyPayrollResult> {
  const [allTeachers, allPositions, allIncentives, allAllowances, allCareerRecords] = await Promise.all([
    db.select().from(teachers),
    db.select().from(positions),
    db.select().from(levelIncentives),
    db.select().from(teacherAllowances),
    db.select().from(careerRecords),
  ]);

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
    const activeTeachers = allTeachers.filter(t => {
      const joined = t.createdAt ? new Date(t.createdAt) : null;
      if (joined && joined > endOfMonth) return false;
      const resigned = t.resignedAt ? new Date(t.resignedAt) : null;
      if (resigned && resigned < startOfMonth) return false;
      return true;
    });
    const staffCost = activeTeachers.reduce((sum, t) => sum + computeTeacherSalary(t, endOfMonth), 0);
    const isForecast = year > currentYear || (year === currentYear && i > currentMonthIdx);
    return { monthIdx: i, month, staffCost, teacherCount: activeTeachers.length, isForecast };
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
  /** Final profit-share weight: (baseWeight + levelWeight), halved if part-time. */
  weight: number;
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
      if (!isActive) {
        return {
          monthIdx: i, positionId: null, positionCode: null, positionName: null,
          level: 0, baseWeight: 0, levelWeight: 0, weight: 0,
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

      let weight = baseWeight + levelWeight;
      if (isPartTime) weight = weight / 2;

      // Override: use custom weight if the teacher has set a manual override
      if (t.overrideProfitShareWeight && t.customProfitShareWeight != null) {
        weight = t.customProfitShareWeight;
      }

      return {
        monthIdx: i,
        positionId: effectivePositionId,
        positionCode: pos?.positionId ?? null,
        positionName: pos?.name ?? null,
        level: effectiveLevel,
        baseWeight,
        levelWeight,
        weight,
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
