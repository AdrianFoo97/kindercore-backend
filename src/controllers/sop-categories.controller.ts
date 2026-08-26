import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { sopCategories } from '../db/schema.js';

// Offered as swatch choices when creating/editing a category — also cycled
// as the default for a new category so it starts visually distinct without
// an admin having to pick one.
export const PALETTE = ['#5a67d8', '#0d9488', '#b45309', '#be185d', '#0369a1', '#7c3aed', '#059669', '#dc2626'];

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(sopCategories)
    .where(isNull(sopCategories.deletedAt))
    .orderBy(asc(sopCategories.displayOrder));
  res.json(rows);
}

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(20).optional(),
});

export async function createCategory(req: Request, res: Response): Promise<void> {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const [{ max }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${sopCategories.displayOrder}), -1)` })
    .from(sopCategories)
    .where(isNull(sopCategories.deletedAt));
  const displayOrder = (Number(max) ?? -1) + 1;
  const id = randomUUID();
  await db.insert(sopCategories).values({
    id,
    name: parsed.data.name.trim(),
    color: parsed.data.color ?? PALETTE[displayOrder % PALETTE.length],
    displayOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(sopCategories).where(eq(sopCategories.id, id));
  res.json(row);
}

const patchCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().min(1).max(20).optional(),
});

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopCategories).where(eq(sopCategories.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'Category not found' });
    return;
  }
  const update: { name?: string; color?: string } = {};
  if (parsed.data.name != null) update.name = parsed.data.name.trim();
  if (parsed.data.color != null) update.color = parsed.data.color;
  await db.update(sopCategories).set({ ...update, updatedAt: new Date() }).where(eq(sopCategories.id, id));
  const [row] = await db.select().from(sopCategories).where(eq(sopCategories.id, id));
  res.json(row);
}

// Soft-delete only — any SopTemplateCategory rows pointing at this category
// are left dangling on purpose. listTemplates joins with
// isNull(sopCategories.deletedAt), so affected SOPs just quietly lose the
// label; nothing else needs cleaning up.
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(sopCategories).where(eq(sopCategories.id, id));
  if (!existing) { res.status(404).json({ message: 'Category not found' }); return; }
  await db.update(sopCategories).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sopCategories.id, id));
  res.json({ ok: true });
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)),
});

export async function reorderCategories(req: Request, res: Response): Promise<void> {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx.update(sopCategories)
        .set({ displayOrder: i, updatedAt: now })
        .where(eq(sopCategories.id, parsed.data.orderedIds[i]));
    }
  });
  res.json({ ok: true });
}
