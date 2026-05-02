import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, pool } from '../db/client.js';
import { positions, levelIncentives, teachers, teacherAllowances, allowanceTypes, careerRecords, careerMissions, systemSettings } from '../db/schema.js';
import { computeMonthlyPayroll, computeTeacherWeightsByMonth, isTeacherActiveInMonth } from '../services/payroll.service.js';

// Snapshot helper — "is the teacher active this calendar month?"
function isTeacherActiveNow(t: { isActive: boolean; createdAt: Date | string | null; resignedAt: Date | string | null }): boolean {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return isTeacherActiveInMonth(t, startOfMonth, endOfMonth);
}

// ── Positions ────────────────────────────────────────────────────────────────

export async function getPositions(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(positions).orderBy(positions.sortOrder);
  res.json(rows);
}

const upsertPositionSchema = z.object({
  name: z.string().min(1),
  titleWeight: z.number().int().min(0),
  basicSalary: z.number().min(0),
  maxLevel: z.number().int().min(0).max(10),
  sortOrder: z.number().int().min(0).optional(),
  inCareerProgression: z.boolean().optional(),
  badgeUrl: z.string().max(500).nullable().optional(),
  starColor: z.string().max(20).nullable().optional(),
});

export async function upsertPosition(req: Request, res: Response): Promise<void> {
  const { positionId } = req.params;
  if (!positionId || positionId.length > 10) {
    res.status(400).json({ message: 'Invalid positionId' });
    return;
  }
  const parsed = upsertPositionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const [existing] = await db.select().from(positions).where(eq(positions.positionId, positionId));
  if (existing) {
    await db.update(positions).set({ ...parsed.data, updatedAt: now }).where(eq(positions.positionId, positionId));
  } else {
    await db.insert(positions).values({
      positionId,
      name: parsed.data.name,
      titleWeight: parsed.data.titleWeight,
      basicSalary: parsed.data.basicSalary,
      maxLevel: parsed.data.maxLevel,
      sortOrder: parsed.data.sortOrder ?? 0,
      inCareerProgression: parsed.data.inCareerProgression ?? true,
      badgeUrl: parsed.data.badgeUrl ?? null,
      starColor: parsed.data.starColor ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const [updated] = await db.select().from(positions).where(eq(positions.positionId, positionId));
  res.json(updated);
}

export async function deletePosition(req: Request, res: Response): Promise<void> {
  const { positionId } = req.params;
  // Check if any teachers use this position
  const [usage] = await db.select({ count: sql<number>`COUNT(*)` }).from(teachers).where(eq(teachers.positionId, positionId));
  if (usage && usage.count > 0) {
    res.status(409).json({ message: `Cannot delete — ${usage.count} teacher(s) assigned to this position` });
    return;
  }
  await db.delete(levelIncentives).where(eq(levelIncentives.positionId, positionId));
  // Soft-delete career missions for this position so historical teacher
  // progress rows can still resolve the mission name. New listings filter
  // out missions where deletedAt is set.
  await db.update(careerMissions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(careerMissions.positionId, positionId));
  await db.delete(positions).where(eq(positions.positionId, positionId));
  res.json({ ok: true });
}

// ── Level Incentives ─────────────────────────────────────────────────────────

export async function getLevelIncentives(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(levelIncentives);
  res.json(rows);
}

const upsertMatrixSchema = z.object({
  matrix: z.array(z.object({
    positionId: z.string().min(1),
    level: z.number().int().min(0).max(10),
    amount: z.number().min(0),
  })),
});

export async function upsertLevelIncentives(req: Request, res: Response): Promise<void> {
  const parsed = upsertMatrixSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  // Fetch existing to decide insert vs update
  const existing = await db.select().from(levelIncentives);
  const existingMap = new Map(existing.map(r => [`${r.positionId}|${r.level}`, r]));

  for (const entry of parsed.data.matrix) {
    const key = `${entry.positionId}|${entry.level}`;
    const ex = existingMap.get(key);
    if (ex) {
      if (ex.amount !== entry.amount) {
        await db.update(levelIncentives).set({ amount: entry.amount, updatedAt: now }).where(eq(levelIncentives.id, ex.id));
      }
    } else {
      await db.insert(levelIncentives).values({
        id: randomUUID(),
        positionId: entry.positionId,
        level: entry.level,
        amount: entry.amount,
        updatedAt: now,
      });
    }
  }
  const updated = await db.select().from(levelIncentives);
  res.json(updated);
}

// ── Teachers with salary calculation ─────────────────────────────────────────

// ── Payroll by month ─────────────────────────────────────────────────────────

export async function getPayrollByMonth(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();
  const result = await computeMonthlyPayroll(year);
  const months = result.months.map(m => ({
    month: m.month,
    total: Math.round(m.staffCost),
    teacherCount: m.teacherCount,
    isForecast: m.isForecast,
  }));
  const annualTotal = months.reduce((sum, m) => sum + m.total, 0);
  const actualTotal = months.filter(m => !m.isForecast).reduce((sum, m) => sum + m.total, 0);
  const forecastTotal = months.filter(m => m.isForecast).reduce((sum, m) => sum + m.total, 0);
  res.json({ year: result.year, months, annualTotal, actualTotal, forecastTotal, currentMonthIdx: result.currentMonthIdx });
}

// ── Employer Contributions ───────────────────────────────────────────────────

export async function getEmployerContributions(_req: Request, res: Response): Promise<void> {
  const settingRows = await db.select().from(systemSettings);
  const settingMap = new Map(settingRows.map(r => [r.key, r.value]));
  const get = (key: string, def: number | boolean) => { const v = settingMap.get(key); return (v !== undefined && v !== null ? v : def) as any; };

  const epfEnabled   = get('epf_enabled', true) as boolean;
  const epfRateBelow = get('epf_rate_below', 13) as number;
  const epfRateAbove = get('epf_rate_above', 12) as number;
  const epfThreshold = get('epf_threshold', 5000) as number;
  const socsoEnabled = get('socso_enabled', true) as boolean;
  const socsoRate    = get('socso_rate', 1.75) as number;
  const socsoCeiling = get('socso_ceiling', 4000) as number;
  const eisEnabled   = get('eis_enabled', true) as boolean;
  const eisRate      = get('eis_rate', 0.4) as number;
  const eisCeiling   = get('eis_ceiling', 4000) as number;

  // Fetch teachers — fall back to safe raw query if new columns don't exist yet in DB
  let allTeachers: (typeof teachers.$inferSelect)[];
  try {
    allTeachers = await db.select().from(teachers).then(rows => rows.filter(isTeacherActiveNow));
  } catch (e: any) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      const [rows] = await pool.execute<any[]>(
        `SELECT id, name, positionId, level, isActive, isFixedSalary, fixedSalaryAmount,
                salaryType, hourlyRate, workStartMinute, workEndMinute, workDays,
                createdAt, resignedAt
         FROM Teacher`
      );
      allTeachers = rows
        .map((r: any) => ({
          ...r,
          isActive: !!r.isActive,
          isFixedSalary: !!r.isFixedSalary,
          workDays: typeof r.workDays === 'string' ? JSON.parse(r.workDays) : r.workDays,
          hasEpf: true,
          hasSocso: true,
          hasEis: true,
        }))
        .filter(isTeacherActiveNow);
    } else {
      throw e;
    }
  }

  const [allPositions, allIncentives, allAllowances, allCareerRecords] = await Promise.all([
    db.select().from(positions),
    db.select().from(levelIncentives),
    db.select().from(teacherAllowances),
    db.select().from(careerRecords),
  ]);

  const posMap = new Map(allPositions.map(p => [p.positionId, p]));
  const incMap = new Map(allIncentives.map(i => [`${i.positionId}|${i.level}`, i.amount]));
  const allowMap = new Map<string, number>();
  for (const a of allAllowances) allowMap.set(a.teacherId, (allowMap.get(a.teacherId) ?? 0) + a.amount);

  const careerByTeacher = new Map<string, typeof allCareerRecords>();
  for (const rec of allCareerRecords) {
    const list = careerByTeacher.get(rec.teacherId) ?? [];
    list.push(rec);
    careerByTeacher.set(rec.teacherId, list);
  }
  for (const list of careerByTeacher.values()) list.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());

  const now = new Date();
  const getCareer = (id: string) => {
    for (const rec of (careerByTeacher.get(id) ?? [])) if (new Date(rec.effectiveDate) <= now) return rec;
    return null;
  };

  let totalEpf = 0, totalSocso = 0, totalEis = 0;
  for (const t of allTeachers) {
    const totalAllowances = allowMap.get(t.id) ?? 0;
    const salaryType = t.salaryType ?? (t.isFixedSalary ? 'fixed' : 'formula');
    let salary = 0;
    if (salaryType === 'hourly' && t.hourlyRate != null) {
      const rawHpd = t.workStartMinute != null && t.workEndMinute != null ? (t.workEndMinute - t.workStartMinute) / 60 : 0;
      const hpd = rawHpd >= 6 ? rawHpd - 1 : rawHpd;
      salary = t.hourlyRate * hpd * ((t.workDays as number[] | null)?.length ?? 0) * 4.33 + totalAllowances;
    } else if (salaryType === 'fixed' && t.fixedSalaryAmount != null) {
      salary = t.fixedSalaryAmount + totalAllowances;
    } else {
      const career = getCareer(t.id);
      const posId = career?.positionId ?? t.positionId;
      const level = career?.level ?? t.level ?? 0;
      if (posId) salary = (posMap.get(posId)?.basicSalary ?? 0) + (incMap.get(`${posId}|${level}`) ?? 0) + totalAllowances;
    }
    if (epfEnabled   && t.hasEpf)   totalEpf   += salary <= epfThreshold ? salary * epfRateBelow / 100 : salary * epfRateAbove / 100;
    if (socsoEnabled && t.hasSocso) totalSocso += Math.min(salary, socsoCeiling) * socsoRate / 100;
    if (eisEnabled   && t.hasEis)   totalEis   += Math.min(salary, eisCeiling) * eisRate / 100;
  }

  res.json({
    total: Math.round((totalEpf + totalSocso + totalEis) * 100) / 100,
    epf:   Math.round(totalEpf   * 100) / 100,
    socso: Math.round(totalSocso * 100) / 100,
    eis:   Math.round(totalEis   * 100) / 100,
  });
}

// ── Teacher title weight by month ────────────────────────────────────────────

export async function getTeacherWeightsByMonth(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();
  const result = await computeTeacherWeightsByMonth(year);
  res.json(result);
}

export async function getTeachersWithSalary(_req: Request, res: Response): Promise<void> {
  const [allTeachers, allPositions, allIncentives, allAllowances, allTypes, allCareerRecords] = await Promise.all([
    db.select().from(teachers),
    db.select().from(positions),
    db.select().from(levelIncentives),
    db.select().from(teacherAllowances),
    db.select().from(allowanceTypes).orderBy(allowanceTypes.sortOrder),
    db.select().from(careerRecords),
  ]);

  const posMap = new Map(allPositions.map(p => [p.positionId, p]));
  const incMap = new Map(allIncentives.map(i => [`${i.positionId}|${i.level}`, i.amount]));
  const typeMap = new Map(allTypes.map(t => [t.id, t]));

  // Build career record map for current effective position lookup
  const careerByTeacher = new Map<string, typeof allCareerRecords>();
  for (const rec of allCareerRecords) {
    const list = careerByTeacher.get(rec.teacherId) ?? [];
    list.push(rec);
    careerByTeacher.set(rec.teacherId, list);
  }
  for (const list of careerByTeacher.values()) {
    list.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
  }
  const now = new Date();
  const getEffectiveCareer = (teacherId: string) => {
    const records = careerByTeacher.get(teacherId);
    if (!records) return null;
    for (const rec of records) {
      if (new Date(rec.effectiveDate) <= now) return rec;
    }
    return null;
  };

  // Group allowances by teacher
  const teacherAllowanceMap = new Map<string, Array<{ typeId: string; typeName: string; amount: number }>>();
  for (const a of allAllowances) {
    const list = teacherAllowanceMap.get(a.teacherId) ?? [];
    const typeName = typeMap.get(a.allowanceTypeId)?.name ?? 'Unknown';
    list.push({ typeId: a.allowanceTypeId, typeName, amount: a.amount });
    teacherAllowanceMap.set(a.teacherId, list);
  }

  const result = allTeachers
    .filter(isTeacherActiveNow)
    .map(t => {
      const allowances = teacherAllowanceMap.get(t.id) ?? [];
      const totalAllowances = allowances.reduce((s, a) => s + a.amount, 0);

      let calculatedSalary = 0;
      let breakdown: { basic: number; levelIncentive: number; allowances: typeof allowances; totalAllowances: number } | null = null;

      const salaryType = t.salaryType ?? (t.isFixedSalary ? 'fixed' : 'formula');

      // Resolve career-record-aware position/level (used for formula salary and position display)
      const career = getEffectiveCareer(t.id);
      const effectivePositionId = career?.positionId ?? t.positionId ?? null;
      const effectiveLevel = career?.level ?? t.level ?? 0;

      if (salaryType === 'hourly' && t.hourlyRate != null) {
        // Calculate monthly hours from schedule (minus 1 hour lunch break if 6+ hour day)
        const rawHoursPerDay = (t.workStartMinute != null && t.workEndMinute != null)
          ? (t.workEndMinute - t.workStartMinute) / 60 : 0;
        const hoursPerDay = rawHoursPerDay >= 6 ? rawHoursPerDay - 1 : rawHoursPerDay;
        const daysPerWeek = t.workDays ? (t.workDays as number[]).length : 0;
        const monthlyHours = hoursPerDay * daysPerWeek * 4.33;
        const basic = t.hourlyRate * monthlyHours;
        calculatedSalary = basic + totalAllowances;
        breakdown = { basic, levelIncentive: 0, allowances, totalAllowances };
      } else if (salaryType === 'fixed' && t.fixedSalaryAmount != null) {
        calculatedSalary = t.fixedSalaryAmount + totalAllowances;
        breakdown = { basic: t.fixedSalaryAmount, levelIncentive: 0, allowances, totalAllowances };
      } else if (effectivePositionId) {
        const pos = posMap.get(effectivePositionId);
        const basic = pos?.basicSalary ?? 0;
        const levelInc = incMap.get(`${effectivePositionId}|${effectiveLevel}`) ?? 0;
        calculatedSalary = basic + levelInc + totalAllowances;
        breakdown = { basic, levelIncentive: levelInc, allowances, totalAllowances };
      }

      return {
        ...t,
        level: effectiveLevel,
        positionId: effectivePositionId,
        position: effectivePositionId ? posMap.get(effectivePositionId) ?? null : null,
        calculatedSalary,
        breakdown,
      };
    });

  res.json(result);
}
