import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { positions, teacherAppraisals, teachers } from '../db/schema.js';
import { averageOverWindow, currentMalaysiaMonth, periodAverages, previousAppraisal, quarterAverages, type AppraisalAverage, type YearMonth } from '../services/appraisal.service.js';
import { runsCovering } from '../services/appraisalRuns.service.js';
import { OUTSIDE_TEAM, inStaffScope, staffScopeFor } from '../services/performanceScope.service.js';
import { isOwnTeacher } from '../middlewares/auth.middleware.js';

/** Whose appraisals this person may see as HR: their team, or everyone (performanceScope). */
const scopeOf = (req: Request) => staffScopeFor({ id: req.user!.id, role: req.user!.role, teacherId: req.user!.teacherId ?? null });

// A teacher's average over the 12 months up to this month. Drives the
// "Average appraisal > 75%" promotion gate (getTeacherCareer) and the
// averages shown on the staff record and the teacher's own Appraisal page.
export async function computeAverageAppraisal(teacherId: string, end: YearMonth = currentMalaysiaMonth()): Promise<AppraisalAverage> {
  const rows = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.teacherId, teacherId));
  return averageOverWindow(rows, end);
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listAppraisals(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  // Your own always; someone else's only if they're in your scope (your team, unless you may see everyone).
  if (!isOwnTeacher(req) && !inStaffScope(await scopeOf(req), teacherId)) { res.status(403).json({ message: OUTSIDE_TEAM }); return; }
  const rows = await db
    .select()
    .from(teacherAppraisals)
    .where(eq(teacherAppraisals.teacherId, teacherId))
    .orderBy(desc(teacherAppraisals.year), desc(teacherAppraisals.month));
  const summary = await computeAverageAppraisal(teacherId);
  // Year to date (this year's months so far, Malaysia time) and each quarter's average — the one rule in appraisal.service.
  const today = currentMalaysiaMonth();
  const yearToDate = { year: today.year, average: periodAverages(rows, { year: today.year, month: today.month }).year };
  res.json({ items: rows, summary, yearToDate, quarters: quarterAverages(rows) });
}

// ── Overview (HR → Appraisals) ──────────────────────────────────────────────
// Every current staff member for one month: their appraisal that month (or
// none — "due") and their 12-month average as of that month. Every position
// can be appraised; only career-track positions use it for promotion.

const overviewQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(0).max(11).optional(),
});

export async function listAppraisalOverview(req: Request, res: Response): Promise<void> {
  const parsed = overviewQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  const now = currentMalaysiaMonth();
  const target: YearMonth = { year: parsed.data.year ?? now.year, month: parsed.data.month ?? now.month };
  // Staff who were with us at some point in that month — joined by its end,
  // not resigned before it started.
  const monthStart = new Date(Date.UTC(target.year, target.month, 1));
  const monthEnd = new Date(Date.UTC(target.year, target.month + 1, 1));

  const [staff, appraisals, positionRows, runs] = await Promise.all([
    db.select({ id: teachers.id, name: teachers.name, color: teachers.color, positionId: teachers.positionId, isActive: teachers.isActive, resignedAt: teachers.resignedAt, createdAt: teachers.createdAt })
      .from(teachers),
    db.select().from(teacherAppraisals),
    // Looked up separately: Teacher.positionId and Position.positionId have different collations.
    db.select({ id: positions.positionId, name: positions.name }).from(positions),
    // Appraisals the schedule created whose period includes this month — pending, ongoing or done.
    runsCovering(target.year, target.month),
  ]);
  const positionName = new Map(positionRows.map(p => [p.id, p.name]));
  const byTeacher = new Map<string, typeof appraisals>();
  for (const a of appraisals) byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), a]);

  const scope = await scopeOf(req);
  const rows = staff
    .filter(t => t.createdAt < monthEnd && (t.resignedAt ? t.resignedAt >= monthStart : t.isActive) && inStaffScope(scope, t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => {
      const own = byTeacher.get(t.id) ?? [];
      const thisMonth = own.find(a => a.year === target.year && a.month === target.month) ?? null;
      const previous = previousAppraisal(own, target);
      return {
        teacherId: t.id,
        name: t.name,
        color: t.color,
        positionName: t.positionId ? positionName.get(t.positionId) ?? null : null,
        appraisal: thisMonth,
        runs: runs.filter(r => r.teacherId === t.id).map(({ teacherId: _t, ...r }) => r),
        previous: previous ? { year: previous.year, month: previous.month, score: previous.score } : null,
        twelveMonth: averageOverWindow(own, target),
        // This quarter and this year so far, up to the month shown.
        averages: periodAverages(own, target),
        // The scores behind those averages: each month of the year so far (for the hover breakdown).
        yearScores: own.filter(a => a.year === target.year && a.month <= target.month)
          .sort((a, b) => a.month - b.month).map(a => ({ month: a.month, score: a.score })),
      };
    });
  res.json({ year: target.year, month: target.month, staff: rows });
}

// ── Upsert ───────────────────────────────────────────────────────────────────

/** A month scored with an appraisal form stays as that form worked it out — so it always matches the scores behind it. */
export const FROM_FORM_MESSAGE = 'This month was scored with an appraisal form, so it can’t be changed here — open the appraisal instead.';

const upsertSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(0).max(11),
  score: z.number().min(0).max(100),
  notes: z.string().nullable().optional(),
  evaluatedBy: z.string().nullable().optional(),
});

// Upsert by (teacherId, year, month) — overwrites prior score for the
// same month so admins can correct mistakes without delete-then-create.
export async function upsertAppraisal(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  if (!teacher) { res.status(404).json({ message: 'Teacher not found' }); return; }
  if (!inStaffScope(await scopeOf(req), teacherId)) { res.status(403).json({ message: OUTSIDE_TEAM }); return; }

  const now = new Date();
  const [existing] = await db.select().from(teacherAppraisals)
    .where(and(
      eq(teacherAppraisals.teacherId, teacherId),
      eq(teacherAppraisals.year, parsed.data.year),
      eq(teacherAppraisals.month, parsed.data.month),
    ));

  if (existing?.engineAppraisalId) { res.status(409).json({ message: FROM_FORM_MESSAGE }); return; }
  if (existing) {
    await db.update(teacherAppraisals).set({
      score: parsed.data.score,
      notes: parsed.data.notes ?? null,
      evaluatedBy: parsed.data.evaluatedBy ?? null,
      updatedAt: now,
    }).where(eq(teacherAppraisals.id, existing.id));
    const [row] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.id, existing.id));
    res.json(row);
    return;
  }

  const id = randomUUID();
  await db.insert(teacherAppraisals).values({
    id,
    teacherId,
    year: parsed.data.year,
    month: parsed.data.month,
    score: parsed.data.score,
    notes: parsed.data.notes ?? null,
    evaluatedBy: parsed.data.evaluatedBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.id, id));
  res.json(row);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAppraisal(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.id, id));
  if (!existing) { res.status(404).json({ message: 'Appraisal not found' }); return; }
  if (!inStaffScope(await scopeOf(req), existing.teacherId)) { res.status(403).json({ message: OUTSIDE_TEAM }); return; }
  if (existing.engineAppraisalId) { res.status(409).json({ message: FROM_FORM_MESSAGE }); return; }
  await db.delete(teacherAppraisals).where(eq(teacherAppraisals.id, id));
  res.json({ ok: true });
}
