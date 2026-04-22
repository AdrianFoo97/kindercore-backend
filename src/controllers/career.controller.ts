import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { careerRecords, teachers, positions } from '../db/schema.js';

// ── Get all career records for a teacher ─────────────────────────────────────

export async function getCareerRecords(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const rows = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, teacherId))
    .orderBy(desc(careerRecords.createdAt));
  res.json(rows);
}

// ── Get all career records in a year, enriched for display ───────────────────
// Returns raw CareerRecord rows joined with teacher + position metadata so the
// frontend can render "Nabila promoted to EI L1" without extra lookups. Events
// are compared against each teacher's PREVIOUS career record to classify as
// promotion / demotion / position-change / first-assignment.

export async function getCareerRecordsByYear(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59);

  const [all, allTeachers, allPositions] = await Promise.all([
    db.select().from(careerRecords),
    db.select().from(teachers),
    db.select().from(positions),
  ]);

  const teacherMap = new Map(allTeachers.map(t => [t.id, t]));
  const posMap = new Map(allPositions.map(p => [p.positionId, p]));

  // Sort all records globally by effectiveDate ascending so we can walk a
  // teacher's timeline in order and know the "previous" record.
  const sorted = [...all].sort((a, b) =>
    new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime()
  );
  const lastByTeacher = new Map<string, typeof sorted[0]>();

  const result: any[] = [];
  for (const rec of sorted) {
    const prev = lastByTeacher.get(rec.teacherId) ?? null;
    lastByTeacher.set(rec.teacherId, rec);

    const eff = new Date(rec.effectiveDate);
    if (eff < startOfYear || eff > endOfYear) continue;

    const teacher = teacherMap.get(rec.teacherId);
    const currentPos = posMap.get(rec.positionId);
    const prevPos = prev ? posMap.get(prev.positionId) : null;

    let eventType: 'promotion' | 'demotion' | 'position_change' | 'assignment' = 'assignment';
    if (prev) {
      if (prev.positionId !== rec.positionId) {
        // Compare positions by titleWeight when available to classify direction
        const prevW = prevPos?.titleWeight ?? 0;
        const currW = currentPos?.titleWeight ?? 0;
        if (currW > prevW) eventType = 'promotion';
        else if (currW < prevW) eventType = 'demotion';
        else eventType = 'position_change';
      } else if (rec.level > prev.level) {
        eventType = 'promotion';
      } else if (rec.level < prev.level) {
        eventType = 'demotion';
      } else {
        eventType = 'position_change';
      }
    }

    result.push({
      id: rec.id,
      teacherId: rec.teacherId,
      teacherName: teacher?.name ?? 'Unknown',
      teacherColor: teacher?.color ?? '#94a3b8',
      positionId: rec.positionId,
      positionName: currentPos?.name ?? rec.positionId,
      level: rec.level,
      prevPositionId: prev?.positionId ?? null,
      prevPositionName: prevPos?.name ?? null,
      prevLevel: prev?.level ?? null,
      effectiveDate: rec.effectiveDate,
      notes: rec.notes,
      eventType,
    });
  }

  res.json(result);
}

// ── Create a career record (promotion / position change) ─────────────────────

const createSchema = z.object({
  positionId: z.string().min(1).max(10),
  level: z.number().int().min(0).max(10),
  effectiveDate: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export async function createCareerRecord(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  if (!teacher) { res.status(404).json({ message: 'Teacher not found' }); return; }

  const id = randomUUID();
  const now = new Date();
  await db.insert(careerRecords).values({
    id,
    teacherId,
    positionId: parsed.data.positionId,
    level: parsed.data.level,
    effectiveDate: new Date(parsed.data.effectiveDate),
    notes: parsed.data.notes ?? null,
    createdAt: now,
  });

  // Update teacher's current position/level to match the latest record
  const [latest] = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, teacherId))
    .orderBy(desc(careerRecords.createdAt))
    .limit(1);

  if (latest) {
    await db.update(teachers).set({
      positionId: latest.positionId,
      level: latest.level,
      updatedAt: now,
    }).where(eq(teachers.id, teacherId));
  }

  const [created] = await db.select().from(careerRecords).where(eq(careerRecords.id, id));
  res.status(201).json(created);
}

// ── Update a career record ───────────────────────────────────────────────────

const updateSchema = z.object({
  positionId: z.string().min(1).max(10).optional(),
  level: z.number().int().min(0).max(10).optional(),
  effectiveDate: z.string().optional(),
  notes: z.string().nullable().optional(),
});

export async function updateCareerRecord(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(careerRecords).where(eq(careerRecords.id, id));
  if (!existing) { res.status(404).json({ message: 'Record not found' }); return; }

  const setData: any = {};
  if (parsed.data.positionId !== undefined) setData.positionId = parsed.data.positionId;
  if (parsed.data.level !== undefined) setData.level = parsed.data.level;
  if (parsed.data.effectiveDate !== undefined) setData.effectiveDate = new Date(parsed.data.effectiveDate);
  if (parsed.data.notes !== undefined) setData.notes = parsed.data.notes;

  await db.update(careerRecords).set(setData).where(eq(careerRecords.id, id));

  // Sync teacher's current position/level with latest record
  const [latest] = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, existing.teacherId))
    .orderBy(desc(careerRecords.createdAt))
    .limit(1);

  if (latest) {
    await db.update(teachers).set({
      positionId: latest.positionId,
      level: latest.level,
      updatedAt: new Date(),
    }).where(eq(teachers.id, existing.teacherId));
  }

  const [updated] = await db.select().from(careerRecords).where(eq(careerRecords.id, id));
  res.json(updated);
}

// ── Delete a career record ───────────────────────────────────────────────────

export async function deleteCareerRecord(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(careerRecords).where(eq(careerRecords.id, id));
  if (!existing) { res.status(404).json({ message: 'Record not found' }); return; }

  await db.delete(careerRecords).where(eq(careerRecords.id, id));

  // Sync teacher's current position/level with latest remaining record
  const [latest] = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, existing.teacherId))
    .orderBy(desc(careerRecords.createdAt))
    .limit(1);

  if (latest) {
    await db.update(teachers).set({
      positionId: latest.positionId,
      level: latest.level,
      updatedAt: new Date(),
    }).where(eq(teachers.id, existing.teacherId));
  } else {
    // No records left — clear position/level
    await db.update(teachers).set({
      positionId: null,
      level: 0,
      updatedAt: new Date(),
    }).where(eq(teachers.id, existing.teacherId));
  }

  res.json({ ok: true });
}
