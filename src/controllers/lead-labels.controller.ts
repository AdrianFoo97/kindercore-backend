import { Request, Response } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import { leadLabels, leadLabelAssignments, leads } from '../db/schema.js';

const upsertSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex like #5a67d8'),
});

export async function listLeadLabels(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .select({ id: leadLabels.id, name: leadLabels.name, color: leadLabels.color, leadCount: sql<number>`COUNT(${leadLabelAssignments.id})` })
    .from(leadLabels)
    .leftJoin(leadLabelAssignments, eq(leadLabelAssignments.labelId, leadLabels.id))
    .groupBy(leadLabels.id)
    .orderBy(asc(leadLabels.name));
  res.json(rows.map(r => ({ ...r, leadCount: Number(r.leadCount) })));
}

export async function createLeadLabel(req: Request, res: Response): Promise<void> {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(leadLabels).where(eq(leadLabels.name, parsed.data.name));
  if (existing) { res.status(409).json({ message: `Label "${parsed.data.name}" already exists` }); return; }

  const id = randomUUID();
  const now = new Date();
  await db.insert(leadLabels).values({ id, name: parsed.data.name, color: parsed.data.color, createdAt: now, updatedAt: now });
  const [row] = await db.select().from(leadLabels).where(eq(leadLabels.id, id));
  res.json({ ...row, leadCount: 0 });
}

const patchSchema = upsertSchema.partial();

export async function updateLeadLabel(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(leadLabels).where(eq(leadLabels.id, id));
  if (!existing) { res.status(404).json({ message: 'Label not found' }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (parsed.data.name) {
    const [dupe] = await db.select().from(leadLabels).where(eq(leadLabels.name, parsed.data.name));
    if (dupe && dupe.id !== id) { res.status(409).json({ message: `Label "${parsed.data.name}" already exists` }); return; }
  }
  await db.update(leadLabels).set({ ...parsed.data, updatedAt: new Date() }).where(eq(leadLabels.id, id));
  const [row] = await db.select().from(leadLabels).where(eq(leadLabels.id, id));
  res.json(row);
}

export async function deleteLeadLabel(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(leadLabels).where(eq(leadLabels.id, id));
  if (!existing) { res.status(404).json({ message: 'Label not found' }); return; }
  // Not blocked by existing assignments — a label is a lightweight tag,
  // not structural data, so deleting it just un-tags whatever leads had
  // it instead of forcing the admin to untag everything first.
  await db.transaction(async (tx) => {
    await tx.delete(leadLabelAssignments).where(eq(leadLabelAssignments.labelId, id));
    await tx.delete(leadLabels).where(eq(leadLabels.id, id));
  });
  res.json({ ok: true });
}

const setLeadLabelsSchema = z.object({ labelIds: z.array(z.string()) });

// PUT /api/leads/:id/labels — full-replace, same idiom as setAuthRoleModules.
export async function setLeadLabels(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, id));
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }
  const parsed = setLeadLabelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(leadLabelAssignments).where(eq(leadLabelAssignments.leadId, id));
    for (const labelId of [...new Set(parsed.data.labelIds)]) {
      await tx.insert(leadLabelAssignments).values({ id: randomUUID(), leadId: id, labelId, createdAt: now });
    }
  });
  res.json({ ok: true });
}
