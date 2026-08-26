import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { sopSections } from '../db/schema.js';

export async function listSections(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(sopSections)
    .where(isNull(sopSections.deletedAt))
    .orderBy(asc(sopSections.displayOrder));
  res.json(rows);
}

const createSectionSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function createSection(req: Request, res: Response): Promise<void> {
  const parsed = createSectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const [{ max }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${sopSections.displayOrder}), -1)` })
    .from(sopSections)
    .where(isNull(sopSections.deletedAt));
  const displayOrder = (Number(max) ?? -1) + 1;
  const id = randomUUID();
  await db.insert(sopSections).values({
    id,
    name: parsed.data.name.trim(),
    displayOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(sopSections).where(eq(sopSections.id, id));
  res.json(row);
}

const patchSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export async function updateSection(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchSectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopSections).where(eq(sopSections.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'Section not found' });
    return;
  }
  const update: { name?: string } = {};
  if (parsed.data.name != null) update.name = parsed.data.name.trim();
  await db.update(sopSections).set({ ...update, updatedAt: new Date() }).where(eq(sopSections.id, id));
  const [row] = await db.select().from(sopSections).where(eq(sopSections.id, id));
  res.json(row);
}

// Soft-delete only — steps that already used this section name keep their
// text as-is (SopStep.section is a plain string, not a foreign key), so
// nothing else needs cleaning up. It just stops showing up as a choice.
export async function deleteSection(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(sopSections).where(eq(sopSections.id, id));
  if (!existing) { res.status(404).json({ message: 'Section not found' }); return; }
  await db.update(sopSections).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sopSections.id, id));
  res.json({ ok: true });
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)),
});

export async function reorderSections(req: Request, res: Response): Promise<void> {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx.update(sopSections)
        .set({ displayOrder: i, updatedAt: now })
        .where(eq(sopSections.id, parsed.data.orderedIds[i]));
    }
  });
  res.json({ ok: true });
}
