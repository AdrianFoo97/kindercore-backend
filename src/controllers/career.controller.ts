import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { careerRecords, teachers } from '../db/schema.js';

// ── Get all career records for a teacher ─────────────────────────────────────

export async function getCareerRecords(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const rows = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, teacherId))
    .orderBy(desc(careerRecords.createdAt));
  res.json(rows);
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
