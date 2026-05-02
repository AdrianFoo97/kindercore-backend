import { Request, Response } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { missionCategories, careerMissions } from '../db/schema.js';

// Curated FA icons admin can pick from. Kept short on purpose so the
// picker stays simple and design stays consistent.
const ALLOWED_ICONS = [
  'faRoad', 'faClipboardCheck', 'faCalendarDays', 'faPeopleArrows', 'faStar',
  'faBookOpen', 'faGraduationCap', 'faChalkboardUser', 'faShieldHalved',
  'faHeart', 'faTrophy', 'faMedal',
] as const;

const upsertSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, digits, or underscore'),
  name: z.string().min(1).max(191),
  achievementName: z.string().min(1).max(191),
  description: z.string().nullable().optional(),
  icon: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex like #1e40af'),
  sortOrder: z.number().int().min(0).optional(),
});

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(missionCategories).orderBy(asc(missionCategories.sortOrder));
  res.json(rows);
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(missionCategories).where(eq(missionCategories.code, parsed.data.code));
  if (existing) { res.status(409).json({ message: `Category code "${parsed.data.code}" already exists` }); return; }
  const now = new Date();
  // Default sortOrder = max + 1 if not supplied.
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder == null) {
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${missionCategories.sortOrder}), -1)` })
      .from(missionCategories);
    sortOrder = (Number(max) ?? -1) + 1;
  }
  await db.insert(missionCategories).values({
    code: parsed.data.code,
    name: parsed.data.name,
    achievementName: parsed.data.achievementName,
    description: parsed.data.description ?? null,
    icon: parsed.data.icon,
    color: parsed.data.color,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(missionCategories).where(eq(missionCategories.code, parsed.data.code));
  res.json(row);
}

const patchSchema = upsertSchema.partial().omit({ code: true });

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { code } = req.params;
  const [existing] = await db.select().from(missionCategories).where(eq(missionCategories.code, code));
  if (!existing) { res.status(404).json({ message: 'Category not found' }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  await db.update(missionCategories).set({ ...parsed.data, updatedAt: new Date() }).where(eq(missionCategories.code, code));
  const [row] = await db.select().from(missionCategories).where(eq(missionCategories.code, code));
  res.json(row);
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  const { code } = req.params;
  const [existing] = await db.select().from(missionCategories).where(eq(missionCategories.code, code));
  if (!existing) { res.status(404).json({ message: 'Category not found' }); return; }
  // Block deletion if any live mission still references this category.
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(careerMissions)
    .where(and(eq(careerMissions.category, code), isNull(careerMissions.deletedAt)));
  if (Number(cnt) > 0) {
    res.status(409).json({ message: `Cannot delete — ${cnt} mission${cnt === 1 ? '' : 's'} still use this category` });
    return;
  }
  await db.delete(missionCategories).where(eq(missionCategories.code, code));
  res.json({ ok: true });
}

export async function reorderCategories(req: Request, res: Response): Promise<void> {
  const schema = z.object({ orderedCodes: z.array(z.string()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedCodes.length; i++) {
      await tx.update(missionCategories)
        .set({ sortOrder: i, updatedAt: now })
        .where(eq(missionCategories.code, parsed.data.orderedCodes[i]));
    }
  });
  res.json({ ok: true });
}

export { ALLOWED_ICONS };
