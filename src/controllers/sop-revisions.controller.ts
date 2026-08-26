import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  sopTemplateRevisions, sopTemplates, sopSteps, sopTemplateCategories, users,
} from '../db/schema.js';

const proposedStepSchema = z.object({
  section: z.string().min(1).max(100),
  title: z.string().min(1).max(191),
  detail: z.string().nullable().optional(),
  linkedTemplateId: z.string().min(1).max(36).nullable().optional(),
});

const createRevisionSchema = z.object({
  // Editing an existing SOP vs. proposing a brand-new one — a new proposal
  // has no live template to attach to until it's approved, so this is null.
  sopTemplateId: z.string().min(1).max(36).nullable().optional(),
  title: z.string().min(1).max(191),
  goal: z.string().nullable().optional(),
  videoUrl: z.string().url().max(500).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  steps: z.array(proposedStepSchema),
  categoryIds: z.array(z.string().min(1).max(36)).optional(),
});

export async function listRevisions(req: Request, res: Response): Promise<void> {
  const { status, sopTemplateId } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(sopTemplateRevisions.status, status as any));
  if (sopTemplateId) conditions.push(eq(sopTemplateRevisions.sopTemplateId, sopTemplateId));
  const rows = await db.select().from(sopTemplateRevisions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sopTemplateRevisions.createdAt));
  res.json(rows);
}

export async function createRevision(req: Request, res: Response): Promise<void> {
  const parsed = createRevisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (parsed.data.sopTemplateId) {
    const [existing] = await db.select({ id: sopTemplates.id }).from(sopTemplates)
      .where(and(eq(sopTemplates.id, parsed.data.sopTemplateId), isNull(sopTemplates.deletedAt)));
    if (!existing) {
      res.status(400).json({ message: 'How-To Guide does not exist' });
      return;
    }
  }

  const proposer = req.user!;
  const [userRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, proposer.id));

  const now = new Date();
  const id = randomUUID();
  await db.insert(sopTemplateRevisions).values({
    id,
    sopTemplateId: parsed.data.sopTemplateId ?? null,
    title: parsed.data.title,
    goal: parsed.data.goal ?? null,
    videoUrl: parsed.data.videoUrl ?? null,
    icon: parsed.data.icon ?? null,
    stepsJson: parsed.data.steps,
    categoryIdsJson: parsed.data.categoryIds ?? null,
    status: 'PENDING',
    proposedByUserId: proposer.id,
    proposedByName: userRow?.name ?? proposer.email,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, id));
  res.json(row);
}

export async function approveRevision(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [revision] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, id));
  if (!revision) { res.status(404).json({ message: 'Revision not found' }); return; }
  if (revision.status !== 'PENDING') { res.status(409).json({ message: 'Revision has already been reviewed' }); return; }

  const reviewer = req.user!;
  const [reviewerRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, reviewer.id));
  const now = new Date();
  const steps = revision.stepsJson as { section: string; title: string; detail?: string | null; linkedTemplateId?: string | null }[];
  const categoryIds = (revision.categoryIdsJson as string[] | null) ?? null;

  let templateId = revision.sopTemplateId;
  let newVersion: number;

  await db.transaction(async (tx) => {
    if (templateId) {
      // Editing an existing SOP — bump its version and swap in the
      // proposed content. Old steps are soft-deleted (not hard-deleted)
      // so historical SopObservationStepResult rows can still resolve
      // what they referred to at the time.
      const [existing] = await tx.select().from(sopTemplates).where(eq(sopTemplates.id, templateId));
      newVersion = existing.currentVersion + 1;
      await tx.update(sopTemplates).set({
        title: revision.title,
        goal: revision.goal,
        videoUrl: revision.videoUrl,
        icon: revision.icon ?? existing.icon,
        currentVersion: newVersion,
        updatedAt: now,
      }).where(eq(sopTemplates.id, templateId));
      await tx.update(sopSteps).set({ deletedAt: now, updatedAt: now })
        .where(and(eq(sopSteps.sopTemplateId, templateId), isNull(sopSteps.deletedAt)));
    } else {
      // Brand-new SOP — create the live template now that it's approved.
      newVersion = 1;
      templateId = randomUUID();
      const [{ max }] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${sopTemplates.displayOrder}), -1)` })
        .from(sopTemplates)
        .where(isNull(sopTemplates.deletedAt));
      await tx.insert(sopTemplates).values({
        id: templateId,
        title: revision.title,
        goal: revision.goal,
        videoUrl: revision.videoUrl,
        icon: revision.icon ?? 'faClipboardCheck',
        currentVersion: 1,
        displayOrder: (Number(max) ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      await tx.insert(sopSteps).values({
        id: randomUUID(),
        sopTemplateId: templateId,
        section: st.section,
        title: st.title,
        detail: st.detail ?? null,
        linkedTemplateId: st.linkedTemplateId ?? null,
        displayOrder: i,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (categoryIds) {
      await tx.delete(sopTemplateCategories).where(eq(sopTemplateCategories.sopTemplateId, templateId));
      for (const categoryId of [...new Set(categoryIds)]) {
        await tx.insert(sopTemplateCategories).values({ id: randomUUID(), sopTemplateId: templateId!, categoryId, createdAt: now });
      }
    }

    await tx.update(sopTemplateRevisions).set({
      sopTemplateId: templateId,
      status: 'APPROVED',
      versionNumber: newVersion,
      reviewedByUserId: reviewer.id,
      reviewedByName: reviewerRow?.name ?? reviewer.email,
      reviewedAt: now,
      updatedAt: now,
    }).where(eq(sopTemplateRevisions.id, id));
  });

  const [row] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, id));
  res.json(row);
}

const rejectSchema = z.object({
  reviewNote: z.string().max(1000).nullable().optional(),
});

export async function rejectRevision(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [revision] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, id));
  if (!revision) { res.status(404).json({ message: 'Revision not found' }); return; }
  if (revision.status !== 'PENDING') { res.status(409).json({ message: 'Revision has already been reviewed' }); return; }

  const reviewer = req.user!;
  const [reviewerRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, reviewer.id));
  const now = new Date();
  await db.update(sopTemplateRevisions).set({
    status: 'REJECTED',
    reviewedByUserId: reviewer.id,
    reviewedByName: reviewerRow?.name ?? reviewer.email,
    reviewedAt: now,
    reviewNote: parsed.data.reviewNote ?? null,
    updatedAt: now,
  }).where(eq(sopTemplateRevisions.id, id));

  const [row] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, id));
  res.json(row);
}
