import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { operatingCostCategories, operatingCostCategoryGroups, operatingCosts } from '../db/schema.js';

// ── Groups (aka "Main Categories") ───────────────────────────────────────────

export async function listGroups(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .select()
    .from(operatingCostCategoryGroups)
    .orderBy(asc(operatingCostCategoryGroups.sortOrder), asc(operatingCostCategoryGroups.name));
  res.json(rows);
}

const upsertGroupSchema = z.object({
  name: z.string().min(1).max(191),
  sortOrder: z.number().int().min(0).optional(),
});

export async function createGroup(req: Request, res: Response): Promise<void> {
  const parsed = upsertGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  // Default sortOrder = max + 10 if not provided
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const [max] = await db.select({ v: sql<number>`COALESCE(MAX(sortOrder), 0)` }).from(operatingCostCategoryGroups);
    sortOrder = (max?.v ?? 0) + 10;
  }
  try {
    await db.insert(operatingCostCategoryGroups).values({
      id, name: parsed.data.name, sortOrder, createdAt: now, updatedAt: now,
    });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: 'A main category with this name already exists' });
      return;
    }
    throw err;
  }
  const [row] = await db.select().from(operatingCostCategoryGroups).where(eq(operatingCostCategoryGroups.id, id));
  res.json(row);
}

export async function updateGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = upsertGroupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  try {
    await db
      .update(operatingCostCategoryGroups)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(operatingCostCategoryGroups.id, id));
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: 'A main category with this name already exists' });
      return;
    }
    throw err;
  }
  const [row] = await db.select().from(operatingCostCategoryGroups).where(eq(operatingCostCategoryGroups.id, id));
  if (!row) {
    res.status(404).json({ message: 'Main category not found' });
    return;
  }
  res.json(row);
}

export async function deleteGroup(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  // Protected groups (e.g. HR Benefits) are system-owned and cannot be removed
  const [existing] = await db
    .select({ isProtected: operatingCostCategoryGroups.isProtected })
    .from(operatingCostCategoryGroups)
    .where(eq(operatingCostCategoryGroups.id, id));
  if (!existing) {
    res.status(404).json({ message: 'Main category not found' });
    return;
  }
  if (existing.isProtected) {
    res.status(403).json({ message: 'This main category is protected and cannot be deleted' });
    return;
  }
  // Block deletion if any categories still reference this group
  const [usage] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(operatingCostCategories)
    .where(eq(operatingCostCategories.groupId, id));
  if (usage && usage.count > 0) {
    res.status(409).json({ message: `Cannot delete — ${usage.count} categories belong to this main category` });
    return;
  }
  await db.delete(operatingCostCategoryGroups).where(eq(operatingCostCategoryGroups.id, id));
  res.json({ ok: true });
}

// ── Categories (items within a group) ────────────────────────────────────────

export async function listCategories(_req: Request, res: Response): Promise<void> {
  // JOIN groups + LEFT JOIN cost entries so the UI can show how many recorded
  // rows (and how much money) would be lost if a category were deleted.
  const rows = await db
    .select({
      id: operatingCostCategories.id,
      name: operatingCostCategories.name,
      groupId: operatingCostCategories.groupId,
      groupName: operatingCostCategoryGroups.name,
      groupSortOrder: operatingCostCategoryGroups.sortOrder,
      sortOrder: operatingCostCategories.sortOrder,
      defaultAmount: operatingCostCategories.defaultAmount,
      monthlyBudget: operatingCostCategories.monthlyBudget,
      createdAt: operatingCostCategories.createdAt,
      updatedAt: operatingCostCategories.updatedAt,
      entryCount: sql<number>`COUNT(${operatingCosts.id})`,
      entryTotal: sql<number>`COALESCE(SUM(${operatingCosts.amount}), 0)`,
    })
    .from(operatingCostCategories)
    .innerJoin(operatingCostCategoryGroups, eq(operatingCostCategories.groupId, operatingCostCategoryGroups.id))
    .leftJoin(operatingCosts, eq(operatingCosts.categoryId, operatingCostCategories.id))
    .groupBy(
      operatingCostCategories.id,
      operatingCostCategories.name,
      operatingCostCategories.groupId,
      operatingCostCategoryGroups.name,
      operatingCostCategoryGroups.sortOrder,
      operatingCostCategories.sortOrder,
      operatingCostCategories.defaultAmount,
      operatingCostCategories.monthlyBudget,
      operatingCostCategories.createdAt,
      operatingCostCategories.updatedAt,
    )
    .orderBy(
      asc(operatingCostCategoryGroups.sortOrder),
      asc(operatingCostCategoryGroups.name),
      asc(operatingCostCategories.sortOrder),
      asc(operatingCostCategories.name),
    );
  res.json(rows);
}

const upsertCategorySchema = z.object({
  name: z.string().min(1).max(191),
  groupId: z.string().min(1).max(36),
  sortOrder: z.number().int().min(0).optional(),
  defaultAmount: z.number().min(0).nullable().optional(),
  monthlyBudget: z.number().min(0).nullable().optional(),
});

export async function createCategory(req: Request, res: Response): Promise<void> {
  const parsed = upsertCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  // Verify the group exists
  const [group] = await db.select().from(operatingCostCategoryGroups).where(eq(operatingCostCategoryGroups.id, parsed.data.groupId));
  if (!group) {
    res.status(400).json({ message: 'Invalid main category (groupId)' });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(operatingCostCategories).values({
    id,
    name: parsed.data.name,
    groupId: parsed.data.groupId,
    sortOrder: parsed.data.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(operatingCostCategories).where(eq(operatingCostCategories.id, id));
  res.json(row);
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = upsertCategorySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (parsed.data.groupId) {
    const [group] = await db.select().from(operatingCostCategoryGroups).where(eq(operatingCostCategoryGroups.id, parsed.data.groupId));
    if (!group) {
      res.status(400).json({ message: 'Invalid main category (groupId)' });
      return;
    }
  }
  await db
    .update(operatingCostCategories)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(operatingCostCategories.id, id));
  const [row] = await db.select().from(operatingCostCategories).where(eq(operatingCostCategories.id, id));
  if (!row) {
    res.status(404).json({ message: 'Category not found' });
    return;
  }
  res.json(row);
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  // Cascade: delete any recorded cost entries first, then the category itself.
  // The frontend warns the user about this data loss before calling.
  const deletedEntries = await db.delete(operatingCosts).where(eq(operatingCosts.categoryId, id));
  await db.delete(operatingCostCategories).where(eq(operatingCostCategories.id, id));
  // Drizzle's MySQL delete returns a ResultSetHeader as the first tuple element
  const affectedRows = (deletedEntries as any)?.[0]?.affectedRows ?? 0;
  res.json({ ok: true, deletedEntryCount: affectedRows });
}

// ── Monthly entries (bulk grid) ──────────────────────────────────────────────

export async function getEntries(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));
  res.json({ year, rows });
}

const bulkEntrySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  rows: z.array(z.object({
    categoryId: z.string().min(1),
    month: z.number().int().min(0).max(11),
    amount: z.number().min(0),
    notes: z.string().nullable().optional(),
  })),
});

export async function bulkUpsertEntries(req: Request, res: Response): Promise<void> {
  const parsed = bulkEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { year, rows } = parsed.data;
  const now = new Date();

  const existing = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));
  const existingMap = new Map(existing.map(r => [`${r.categoryId}|${r.month}`, r]));

  for (const entry of rows) {
    const key = `${entry.categoryId}|${entry.month}`;
    const ex = existingMap.get(key);
    if (entry.amount === 0 && !entry.notes) {
      if (ex) {
        await db.delete(operatingCosts).where(eq(operatingCosts.id, ex.id));
      }
      existingMap.delete(key);
      continue;
    }
    if (ex) {
      if (ex.amount !== entry.amount || (ex.notes ?? null) !== (entry.notes ?? null)) {
        await db
          .update(operatingCosts)
          .set({ amount: entry.amount, notes: entry.notes ?? null, updatedAt: now })
          .where(eq(operatingCosts.id, ex.id));
      }
    } else {
      await db.insert(operatingCosts).values({
        id: randomUUID(),
        year,
        month: entry.month,
        categoryId: entry.categoryId,
        amount: entry.amount,
        notes: entry.notes ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    existingMap.delete(key);
  }

  const updated = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));
  res.json({ year, rows: updated });
}
