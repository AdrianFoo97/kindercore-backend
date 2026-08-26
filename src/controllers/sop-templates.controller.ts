import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { sopTemplates, sopTemplateCategories, sopCategories } from '../db/schema.js';

// Flat, organization-wide library — not scoped per position (many SOPs
// apply to everyone), so listing/reordering/displayOrder are all global.

// Curated FA icons admin can pick from. Kept short on purpose so the
// picker stays simple and design stays consistent.
const ALLOWED_ICONS = [
  'faClipboardCheck', 'faListCheck', 'faBookOpen', 'faRoad', 'faShieldHalved',
  'faUtensils', 'faBroom', 'faBoxOpen', 'faPersonWalking', 'faDoorOpen',
  'faTruck', 'faScrewdriverWrench', 'faFirstAid', 'faTriangleExclamation', 'faBell',
  'faFileLines', 'faGear', 'faCheckDouble', 'faUsers', 'faChalkboard',
  'faChild', 'faPhone', 'faEnvelope', 'faClock', 'faLightbulb',
  'faStar', 'faCamera', 'faLock', 'faClipboardList', 'faHandHoldingHeart',
  'faCalendarDays', 'faMoneyBillWave', 'faBus', 'faBed', 'faPuzzlePiece',
  'faPalette', 'faMusic', 'faBook', 'faGraduationCap', 'faUserShield',
  'faBoxesStacked', 'faTrash', 'faFire', 'faDroplet', 'faHandSparkles',
  'faTemperatureHalf', 'faSyringe', 'faBaby', 'faHouse', 'faKey',
] as const;

export async function listTemplates(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(sopTemplates)
    .where(isNull(sopTemplates.deletedAt))
    .orderBy(asc(sopTemplates.displayOrder));

  // One extra query for every template's labels, grouped in JS rather than
  // a SQL join — the table is small (org-wide SOP count), and this keeps
  // the shape simple: each template row gets a `categories` array attached.
  const links = await db.select({
    sopTemplateId: sopTemplateCategories.sopTemplateId,
    id: sopCategories.id,
    name: sopCategories.name,
    color: sopCategories.color,
  })
    .from(sopTemplateCategories)
    .innerJoin(sopCategories, eq(sopTemplateCategories.categoryId, sopCategories.id))
    .where(isNull(sopCategories.deletedAt));

  const byTemplate = new Map<string, { id: string; name: string; color: string }[]>();
  for (const link of links) {
    if (!byTemplate.has(link.sopTemplateId)) byTemplate.set(link.sopTemplateId, []);
    byTemplate.get(link.sopTemplateId)!.push({ id: link.id, name: link.name, color: link.color });
  }

  res.json(rows.map(r => ({ ...r, categories: byTemplate.get(r.id) ?? [] })));
}

const setCategoriesSchema = z.object({
  categoryIds: z.array(z.string().min(1).max(36)),
});

// Full-replace, not incremental add/remove — same idiom as reorderSteps:
// delete everything this template currently has, then insert exactly the
// set the caller sent. Simpler and self-correcting vs. tracking diffs.
export async function setTemplateCategories(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = setCategoriesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'How-To Guide not found' });
    return;
  }
  const now = new Date();
  const categoryIds = [...new Set(parsed.data.categoryIds)];
  await db.transaction(async (tx) => {
    await tx.delete(sopTemplateCategories).where(eq(sopTemplateCategories.sopTemplateId, id));
    for (const categoryId of categoryIds) {
      await tx.insert(sopTemplateCategories).values({ id: randomUUID(), sopTemplateId: id, categoryId, createdAt: now });
    }
  });
  res.json({ ok: true });
}

const upsertTemplateSchema = z.object({
  title: z.string().min(1).max(191),
  goal: z.string().nullable().optional(),
  videoUrl: z.string().url().max(500).nullable().optional(),
  icon: z.enum(ALLOWED_ICONS).optional(),
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
    videoUrl: parsed.data.videoUrl ?? null,
    icon: parsed.data.icon ?? 'faClipboardCheck',
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
    res.status(404).json({ message: 'How-To Guide not found' });
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
  if (!existing) { res.status(404).json({ message: 'How-To Guide not found' }); return; }
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
