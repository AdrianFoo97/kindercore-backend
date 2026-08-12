import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { sopTemplates } from '../db/schema.js';

// Flat, organization-wide library — not scoped per position (many SOPs
// apply to everyone), so listing/reordering/displayOrder are all global.

export async function listTemplates(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(sopTemplates)
    .where(isNull(sopTemplates.deletedAt))
    .orderBy(asc(sopTemplates.displayOrder));
  res.json(rows);
}

const upsertTemplateSchema = z.object({
  title: z.string().min(1).max(191),
  goal: z.string().nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export async function createTemplate(req: Request, res: Response): Promise<void> {
  const parsed = upsertTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  let displayOrder = parsed.data.displayOrder;
  if (displayOrder == null) {
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${sopTemplates.displayOrder}), -1)` })
      .from(sopTemplates)
      .where(isNull(sopTemplates.deletedAt));
    displayOrder = (Number(max) ?? -1) + 1;
  }
  const id = randomUUID();
  await db.insert(sopTemplates).values({
    id,
    title: parsed.data.title,
    goal: parsed.data.goal ?? null,
    displayOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
  res.json(row);
}

const patchTemplateSchema = upsertTemplateSchema.partial();

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'SOP template not found' });
    return;
  }
  await db.update(sopTemplates).set({ ...parsed.data, updatedAt: new Date() }).where(eq(sopTemplates.id, id));
  const [row] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
  res.json(row);
}

// Soft-delete: keep the row so historical SopObservation rows can still
// resolve the template's title.
export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
  if (!existing) { res.status(404).json({ message: 'SOP template not found' }); return; }
  await db.update(sopTemplates).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sopTemplates.id, id));
  res.json({ ok: true });
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)),
});

export async function reorderTemplates(req: Request, res: Response): Promise<void> {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx.update(sopTemplates)
        .set({ displayOrder: i, updatedAt: now })
        .where(eq(sopTemplates.id, parsed.data.orderedIds[i]));
    }
  });
  res.json({ ok: true });
}
