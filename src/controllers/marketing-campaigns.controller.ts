import { Request, Response } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import { marketingCampaigns, leads } from '../db/schema.js';
import { todayInMalaysia, dateKey } from '../utils/dateKey.js';

// Codes are always normalized to uppercase before storing or comparing —
// keeps the public check a plain equality lookup instead of needing a SQL
// UPPER()/LOWER() call, and means "cny2026" and "CNY2026" are the same code.
const baseSchema = z.object({
  name: z.string().min(1).max(191),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, underscore, and dash only'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
});
const upsertSchema = baseSchema.refine(data => data.startDate <= data.endDate, {
  message: 'Start date must be on or before end date', path: ['endDate'],
});

export async function listMarketingCampaigns(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .select({
      id: marketingCampaigns.id, name: marketingCampaigns.name, code: marketingCampaigns.code,
      startDate: marketingCampaigns.startDate, endDate: marketingCampaigns.endDate,
      createdAt: marketingCampaigns.createdAt, updatedAt: marketingCampaigns.updatedAt,
      leadCount: sql<number>`COUNT(${leads.id})`,
    })
    .from(marketingCampaigns)
    .leftJoin(leads, eq(leads.promoCode, marketingCampaigns.code))
    .groupBy(marketingCampaigns.id)
    .orderBy(asc(marketingCampaigns.startDate));
  res.json(rows.map(r => ({ ...r, leadCount: Number(r.leadCount) })));
}

export async function createMarketingCampaign(req: Request, res: Response): Promise<void> {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const code = parsed.data.code.toUpperCase();
  const [existing] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.code, code));
  if (existing) { res.status(409).json({ message: `Promo code "${code}" already exists` }); return; }

  const id = randomUUID();
  const now = new Date();
  await db.insert(marketingCampaigns).values({
    id, name: parsed.data.name, code,
    startDate: new Date(parsed.data.startDate), endDate: new Date(parsed.data.endDate),
    createdAt: now, updatedAt: now,
  });
  const [row] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  res.json({ ...row, leadCount: 0 });
}

const patchSchema = baseSchema.partial().omit({ code: true });

export async function updateMarketingCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  if (!existing) { res.status(404).json({ message: 'Marketing campaign not found' }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { startDate, endDate, ...rest } = parsed.data;
  const nextStart = startDate ? new Date(startDate) : existing.startDate;
  const nextEnd = endDate ? new Date(endDate) : existing.endDate;
  if (nextStart > nextEnd) {
    res.status(400).json({ message: 'Validation error', errors: [{ message: 'Start date must be on or before end date', path: ['endDate'] }] });
    return;
  }
  await db.update(marketingCampaigns).set({
    ...rest, startDate: nextStart, endDate: nextEnd, updatedAt: new Date(),
  }).where(eq(marketingCampaigns.id, id));
  const [row] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  const [countRow] = await db.select({ c: sql<number>`COUNT(*)` }).from(leads).where(eq(leads.promoCode, row.code));
  res.json({ ...row, leadCount: Number(countRow.c) });
}

export async function deleteMarketingCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  if (!existing) { res.status(404).json({ message: 'Marketing campaign not found' }); return; }
  // Not blocked by existing Lead.promoCode usage — that column is a
  // free-text snapshot of what was typed, not a foreign key, so deleting
  // the campaign doesn't orphan anything.
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
  res.json({ ok: true });
}

// Public, unauthenticated — the enquiry form calls this directly from the
// browser to live-validate what a parent types before they can submit.
// Only returns exists/currently-valid-or-not plus the campaign name;
// nothing sensitive, so no auth needed.
export async function checkPromoCode(req: Request, res: Response): Promise<void> {
  const code = String(req.query.code ?? '').trim().toUpperCase();
  if (!code) { res.json({ valid: false }); return; }
  const [match] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.code, code)).limit(1);
  if (!match) { res.json({ valid: false }); return; }
  const today = todayInMalaysia();
  if (today < dateKey(match.startDate) || today > dateKey(match.endDate)) { res.json({ valid: false }); return; }
  res.json({ valid: true, campaignName: match.name });
}
