import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { sopSteps, sopTemplates } from '../db/schema.js';
import { findImage, idFromFileName, saveImage } from '../services/storedImage.service.js';
import { GUIDE_STEP_IMAGE_KIND, UNKNOWN_IMAGE_MESSAGE, unknownGuideImageIds } from '../services/guideStepImages.service.js';

async function assertTemplateExists(sopTemplateId: string): Promise<boolean> {
  const [row] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(eq(sopTemplates.id, sopTemplateId));
  return !!row;
}

export async function listSteps(req: Request, res: Response): Promise<void> {
  const { sopTemplateId } = req.query;
  if (!sopTemplateId) {
    res.status(400).json({ message: 'sopTemplateId is required' });
    return;
  }
  const rows = await db.select().from(sopSteps)
    .where(and(eq(sopSteps.sopTemplateId, String(sopTemplateId)), isNull(sopSteps.deletedAt)))
    .orderBy(asc(sopSteps.displayOrder));
  res.json(rows);
}

const upsertStepSchema = z.object({
  sopTemplateId: z.string().min(1).max(36),
  section: z.string().min(1).max(100),
  title: z.string().min(1).max(191),
  detail: z.string().nullable().optional(),
  linkedTemplateId: z.string().min(1).max(36).nullable().optional(),
  imageId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// A step can't "hand off" to the document it's already part of.
function isSelfLink(sopTemplateId: string, linkedTemplateId: string | null | undefined): boolean {
  return !!linkedTemplateId && linkedTemplateId === sopTemplateId;
}

export async function createStep(req: Request, res: Response): Promise<void> {
  const parsed = upsertStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (!(await assertTemplateExists(parsed.data.sopTemplateId))) {
    res.status(400).json({ message: 'How-To Guide does not exist' });
    return;
  }
  if (isSelfLink(parsed.data.sopTemplateId, parsed.data.linkedTemplateId)) {
    res.status(400).json({ message: 'A step cannot link to the How-To Guide it belongs to' });
    return;
  }
  if (parsed.data.linkedTemplateId && !(await assertTemplateExists(parsed.data.linkedTemplateId))) {
    res.status(400).json({ message: 'Linked How-To Guide does not exist' });
    return;
  }
  if ((await unknownGuideImageIds([parsed.data.imageId])).length) {
    res.status(400).json({ message: UNKNOWN_IMAGE_MESSAGE });
    return;
  }
  const now = new Date();
  let displayOrder = parsed.data.displayOrder;
  if (displayOrder == null) {
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${sopSteps.displayOrder}), -1)` })
      .from(sopSteps)
      .where(and(eq(sopSteps.sopTemplateId, parsed.data.sopTemplateId), isNull(sopSteps.deletedAt)));
    displayOrder = (Number(max) ?? -1) + 1;
  }
  const id = randomUUID();
  await db.insert(sopSteps).values({
    id,
    sopTemplateId: parsed.data.sopTemplateId,
    section: parsed.data.section,
    title: parsed.data.title,
    detail: parsed.data.detail ?? null,
    linkedTemplateId: parsed.data.linkedTemplateId ?? null,
    imageId: parsed.data.imageId ?? null,
    displayOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(sopSteps).where(eq(sopSteps.id, id));
  res.json(row);
}

const patchStepSchema = upsertStepSchema.partial().extend({
  sopTemplateId: z.string().min(1).max(36).optional(),
});

export async function updateStep(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopSteps).where(eq(sopSteps.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'Step not found' });
    return;
  }
  if ('linkedTemplateId' in parsed.data) {
    const targetTemplateId = parsed.data.sopTemplateId ?? existing.sopTemplateId;
    if (isSelfLink(targetTemplateId, parsed.data.linkedTemplateId)) {
      res.status(400).json({ message: 'A step cannot link to the How-To Guide it belongs to' });
      return;
    }
    if (parsed.data.linkedTemplateId && !(await assertTemplateExists(parsed.data.linkedTemplateId))) {
      res.status(400).json({ message: 'Linked How-To Guide does not exist' });
      return;
    }
  }
  if ((await unknownGuideImageIds([parsed.data.imageId])).length) {
    res.status(400).json({ message: UNKNOWN_IMAGE_MESSAGE });
    return;
  }
  await db.update(sopSteps).set({ ...parsed.data, updatedAt: new Date() }).where(eq(sopSteps.id, id));
  const [row] = await db.select().from(sopSteps).where(eq(sopSteps.id, id));
  res.json(row);
}

// Soft-delete: keep the row so historical SopObservationStepResult rows can
// still resolve the step's title/detail.
export async function deleteStep(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(sopSteps).where(eq(sopSteps.id, id));
  if (!existing) { res.status(404).json({ message: 'Step not found' }); return; }
  await db.update(sopSteps).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sopSteps.id, id));
  res.json({ ok: true });
}

const reorderSchema = z.object({
  sopTemplateId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)),
});

export async function reorderSteps(req: Request, res: Response): Promise<void> {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx.update(sopSteps)
        .set({ displayOrder: i, updatedAt: now })
        .where(and(eq(sopSteps.id, parsed.data.orderedIds[i]), eq(sopSteps.sopTemplateId, parsed.data.sopTemplateId)));
    }
  });
  res.json({ ok: true });
}

/** A step photo, from the editor — stored now; it only appears on the guide once a step (or an approved proposal) uses it. */
export async function uploadStepImage(req: Request, res: Response): Promise<void> {
  if (!req.file) { res.status(400).json({ message: 'Choose a photo to add' }); return; }
  const id = await saveImage(GUIDE_STEP_IMAGE_KIND, req.file.mimetype, req.file.buffer);
  res.status(201).json({ id });
}

/** A step photo, for signed-in staff. The id never changes what it shows, so it can be cached for good. */
export async function getStepImage(req: Request, res: Response): Promise<void> {
  const image = await findImage(GUIDE_STEP_IMAGE_KIND, idFromFileName(req.params.id));
  if (!image) { res.status(404).json({ message: 'Photo not found' }); return; }
  res.setHeader('Content-Type', image.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(image.data);
}
