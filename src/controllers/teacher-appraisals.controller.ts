import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { teacherAppraisals, teachers } from '../db/schema.js';

// How many recent monthly scores to average for the promotion gate.
// Six months captures one performance cycle without letting one bad month
// linger forever in the average.
export const APPRAISAL_AVG_WINDOW = 6;
export const APPRAISAL_PASS_THRESHOLD = 75;

// Compute a teacher's average appraisal score over the most recent
// APPRAISAL_AVG_WINDOW months. Used by getTeacherCareer to drive the
// "Average appraisal > 75%" promotion gate. Returns null if no data.
export async function computeAverageAppraisal(teacherId: string): Promise<{
  average: number | null;
  recordCount: number;
  windowSize: number;
}> {
  const rows = await db
    .select()
    .from(teacherAppraisals)
    .where(eq(teacherAppraisals.teacherId, teacherId))
    .orderBy(desc(teacherAppraisals.year), desc(teacherAppraisals.month))
    .limit(APPRAISAL_AVG_WINDOW);
  if (rows.length === 0) return { average: null, recordCount: 0, windowSize: APPRAISAL_AVG_WINDOW };
  const sum = rows.reduce((acc, r) => acc + (r.score ?? 0), 0);
  return {
    average: Math.round(sum / rows.length),
    recordCount: rows.length,
    windowSize: APPRAISAL_AVG_WINDOW,
  };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listAppraisals(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const rows = await db
    .select()
    .from(teacherAppraisals)
    .where(eq(teacherAppraisals.teacherId, teacherId))
    .orderBy(desc(teacherAppraisals.year), desc(teacherAppraisals.month));
  const summary = await computeAverageAppraisal(teacherId);
  res.json({ items: rows, summary });
}

// ── Upsert ───────────────────────────────────────────────────────────────────

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

  const now = new Date();
  const [existing] = await db.select().from(teacherAppraisals)
    .where(and(
      eq(teacherAppraisals.teacherId, teacherId),
      eq(teacherAppraisals.year, parsed.data.year),
      eq(teacherAppraisals.month, parsed.data.month),
    ));

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
  await db.delete(teacherAppraisals).where(eq(teacherAppraisals.id, id));
  res.json({ ok: true });
}
