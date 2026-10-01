import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { bugReports, users } from '../db/schema.js';

const createBugReportSchema = z.object({
  message: z.string().min(1).max(2000),
  pageUrl: z.string().max(500).nullable().optional(),
  appVersion: z.string().max(20).nullable().optional(),
  photoUrls: z.array(z.string().max(500)).max(4).optional(),
});

export async function createBugReport(req: Request, res: Response): Promise<void> {
  const parsed = createBugReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const reporter = req.user!;
  const [userRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, reporter.id));

  const now = new Date();
  const id = randomUUID();
  await db.insert(bugReports).values({
    id,
    message: parsed.data.message,
    pageUrl: parsed.data.pageUrl ?? null,
    appVersion: parsed.data.appVersion ?? null,
    reportedByUserId: reporter.id,
    reportedByName: userRow?.name ?? reporter.email,
    photoUrls: parsed.data.photoUrls ?? null,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(bugReports).where(eq(bugReports.id, id));
  res.json(row);
}

// Admin-only (see bug-reports.routes.ts) — a reporter isn't scoped to
// their own here the way sop-revisions is, since there's no self-service
// "check my submission's status" surface for this yet, only submission.
export async function listBugReports(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(bugReports).orderBy(desc(bugReports.createdAt));
  res.json(rows);
}

export async function resolveBugReport(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select({ id: bugReports.id }).from(bugReports).where(eq(bugReports.id, id));
  if (!existing) { res.status(404).json({ message: 'Bug report not found' }); return; }
  await db.update(bugReports).set({ status: 'RESOLVED', updatedAt: new Date() }).where(eq(bugReports.id, id));
  const [row] = await db.select().from(bugReports).where(eq(bugReports.id, id));
  res.json(row);
}
