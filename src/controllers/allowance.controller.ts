import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { allowanceTypes, teacherAllowances } from '../db/schema.js';

// ── Allowance Types CRUD ─────────────────────────────────────────────────────

export async function getAllowanceTypes(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(allowanceTypes).orderBy(allowanceTypes.sortOrder);
  res.json(rows);
}

const typeSchema = z.object({
  name: z.string().min(1),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  icon: z.string().min(1).max(50).optional(),
  isGuaranteed: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
});

export async function createAllowanceType(req: Request, res: Response): Promise<void> {
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error' }); return; }
  const id = randomUUID();
  await db.insert(allowanceTypes).values({
    id,
    name: parsed.data.name,
    isDefault: parsed.data.isDefault ?? false,
    sortOrder: parsed.data.sortOrder ?? 0,
    icon: parsed.data.icon ?? 'gift',
    isGuaranteed: parsed.data.isGuaranteed ?? true,
    parentId: parsed.data.parentId ?? null,
    createdAt: new Date(),
  });
  const [created] = await db.select().from(allowanceTypes).where(eq(allowanceTypes.id, id));
  res.status(201).json(created);
}

export async function updateAllowanceType(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = typeSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error' }); return; }
  await db.update(allowanceTypes).set(parsed.data).where(eq(allowanceTypes.id, id));
  const [updated] = await db.select().from(allowanceTypes).where(eq(allowanceTypes.id, id));
  res.json(updated);
}

export async function deleteAllowanceType(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  // Delete all teacher allowances of this type
  await db.delete(teacherAllowances).where(eq(teacherAllowances.allowanceTypeId, id));
  await db.delete(allowanceTypes).where(eq(allowanceTypes.id, id));
  res.json({ ok: true });
}

// ── Teacher Allowances ───────────────────────────────────────────────────────

export async function getTeacherAllowances(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const rows = await db.select().from(teacherAllowances).where(eq(teacherAllowances.teacherId, teacherId));
  res.json(rows);
}

const upsertSchema = z.object({
  allowances: z.array(z.object({
    allowanceTypeId: z.string().min(1),
    amount: z.number().min(0),
  })),
});

export async function upsertTeacherAllowances(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error' }); return; }

  const now = new Date();
  const existing = await db.select().from(teacherAllowances).where(eq(teacherAllowances.teacherId, teacherId));
  const existingMap = new Map(existing.map(r => [r.allowanceTypeId, r]));
  const incomingIds = new Set(parsed.data.allowances.map(a => a.allowanceTypeId));

  // Delete any existing allowances not in the incoming payload
  for (const ex of existing) {
    if (!incomingIds.has(ex.allowanceTypeId)) {
      await db.delete(teacherAllowances).where(eq(teacherAllowances.id, ex.id));
    }
  }

  for (const entry of parsed.data.allowances) {
    const ex = existingMap.get(entry.allowanceTypeId);
    if (ex) {
      if (ex.amount !== entry.amount) {
        await db.update(teacherAllowances).set({ amount: entry.amount, updatedAt: now }).where(eq(teacherAllowances.id, ex.id));
      }
    } else if (entry.amount > 0) {
      await db.insert(teacherAllowances).values({
        id: randomUUID(), teacherId, allowanceTypeId: entry.allowanceTypeId,
        amount: entry.amount, updatedAt: now,
      });
    }
  }

  const updated = await db.select().from(teacherAllowances).where(eq(teacherAllowances.teacherId, teacherId));
  res.json(updated);
}
