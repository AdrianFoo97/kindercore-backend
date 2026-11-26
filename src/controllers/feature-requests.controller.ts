import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { featureRequests, users } from '../db/schema.js';
import { notify } from '../services/notifications.service.js';
import { featureRequestedMessage } from '../services/notifications.logic.js';

// Request a feature: anyone signed in sends an idea (title + what it should do);
// admins read and mark them reviewed. The sender doesn't follow a status.

export const MAX_FEATURE_TITLE_LENGTH = 120;
export const MAX_FEATURE_DESCRIPTION_LENGTH = 2000;

const createFeatureRequestSchema = z.object({
  title: z.string().trim().min(1).max(MAX_FEATURE_TITLE_LENGTH),
  message: z.string().trim().min(1).max(MAX_FEATURE_DESCRIPTION_LENGTH),
  pageUrl: z.string().max(500).nullable().optional(),
  appVersion: z.string().max(20).nullable().optional(),
});

/** Sends the idea. Replies with only `{ ok }` — the sender has nothing to follow. */
export async function createFeatureRequest(req: Request, res: Response): Promise<void> {
  const parsed = createFeatureRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Give it a title and say what it should do.', errors: parsed.error.errors });
    return;
  }
  const sender = req.user!;
  const [userRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, sender.id));
  const requestedByName = userRow?.name ?? sender.email;
  const now = new Date();
  await db.insert(featureRequests).values({
    id: randomUUID(),
    title: parsed.data.title,
    message: parsed.data.message,
    pageUrl: parsed.data.pageUrl ?? null,
    appVersion: parsed.data.appVersion ?? null,
    requestedByUserId: sender.id,
    requestedByName,
    status: 'NEW',
    createdAt: now,
    updatedAt: now,
  });
  await notify(featureRequestedMessage({ title: parsed.data.title, requestedByName }), { actorUserId: sender.id });
  res.json({ ok: true });
}

export async function listFeatureRequests(_req: Request, res: Response): Promise<void> {
  res.json(await db.select().from(featureRequests).orderBy(desc(featureRequests.createdAt)));
}

export async function reviewFeatureRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select({ id: featureRequests.id }).from(featureRequests).where(eq(featureRequests.id, id));
  if (!existing) { res.status(404).json({ message: 'Feature request not found' }); return; }
  await db.update(featureRequests).set({ status: 'REVIEWED', updatedAt: new Date() }).where(eq(featureRequests.id, id));
  const [row] = await db.select().from(featureRequests).where(eq(featureRequests.id, id));
  res.json(row);
}
