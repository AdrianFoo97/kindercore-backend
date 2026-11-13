import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import path from 'path';
import { db } from '../db/client.js';
import { facilityIssues, users } from '../db/schema.js';
import { isAdminRole, resolveGrants } from '../middlewares/auth.middleware.js';
import {
  FACILITY_ATTACHMENTS_DIR, attachmentProblem, discardUploads, toAttachment,
} from '../services/facilityAttachments.service.js';

/** The AuthView that makes someone a facility manager (Admin → Views); Admins always are. */
export const FACILITY_MANAGE_VIEW = 'OPERATION_FACILITY_MANAGE';

// Facility issues (Operation → Facilities): any staff member reports
// something broken — a door, a leaking pipe, the aircon — and facility
// managers (the OPERATION_FACILITY_MANAGE view; Admins always) move it
// OPEN → IN_PROGRESS → RESOLVED, with an optional note the reporter sees.

export const FACILITY_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export const FACILITY_CATEGORIES = [
  'DOOR_WINDOW', 'PLUMBING', 'ELECTRICAL', 'AIRCON', 'FURNITURE', 'SAFETY', 'CLEANING', 'OTHER',
] as const;
export const FACILITY_URGENCIES = ['NORMAL', 'URGENT'] as const;

const createSchema = z.object({
  title: z.string().trim().min(1, 'What’s the problem?').max(191),
  category: z.enum(FACILITY_CATEGORIES, { errorMap: () => ({ message: 'Pick what kind of problem it is' }) }),
  location: z.string().trim().min(1, 'Where is it?').max(191),
  description: z.string().trim().max(5000).nullable().optional(),
  urgency: z.enum(FACILITY_URGENCIES).default('NORMAL'),
});

const statusSchema = z.object({
  status: z.enum(FACILITY_STATUSES),
  note: z.string().trim().max(1000).optional(),
});

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

async function nameOf(userId: string, fallback: string): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name ?? fallback;
}

async function loadOne(id: string) {
  const [row] = await db.select().from(facilityIssues).where(eq(facilityIssues.id, id));
  return row ?? null;
}

/**
 * Any signed-in staff member can report an issue; "Reported by" is the
 * caller, never typed in. Arrives as multipart (facilityAttachmentsUpload
 * has already saved any photos / videos); a refused report deletes them.
 */
export async function createFacilityIssue(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { discardUploads(files); validationError(res, parsed.error); return; }
  // A photo or video is required — whoever fixes it needs to see the problem.
  const fileProblem = files.length === 0 ? 'Add a photo or video of the problem' : attachmentProblem(files);
  if (fileProblem) { discardUploads(files); res.status(400).json({ message: fileProblem }); return; }
  const d = parsed.data;
  const now = new Date();
  const id = randomUUID();
  await db.insert(facilityIssues).values({
    id,
    title: d.title,
    category: d.category,
    location: d.location,
    description: d.description || null,
    urgency: d.urgency,
    attachments: files.length ? files.map(toAttachment) : null,
    status: 'OPEN',
    reportedByUserId: req.user!.id,
    reportedByName: await nameOf(req.user!.id, req.user!.email),
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json(await loadOne(id));
}

/** The caller's own reports, newest first — so they can see where each one stands. */
export async function listMyFacilityIssues(req: Request, res: Response): Promise<void> {
  res.json(await db.select().from(facilityIssues)
    .where(eq(facilityIssues.reportedByUserId, req.user!.id))
    .orderBy(desc(facilityIssues.createdAt)));
}

/** Every report, newest first — facility managers. */
export async function listFacilityIssues(_req: Request, res: Response): Promise<void> {
  res.json(await db.select().from(facilityIssues).orderBy(desc(facilityIssues.createdAt)));
}

/**
 * One photo / video from a report — only to whoever reported it, facility
 * managers and Admins (files sit outside the public /uploads mount).
 * sendFile answers Range requests, so videos can seek.
 */
export async function getFacilityAttachment(req: Request, res: Response): Promise<void> {
  const issue = await loadOne(req.params.id);
  const file = issue?.attachments?.find(a => a.id === req.params.fileId);
  if (!issue || !file) { res.status(404).json({ message: 'Attachment not found' }); return; }

  const mayView = issue.reportedByUserId === req.user!.id
    || isAdminRole(req.user!.role)
    || (await resolveGrants(req.user!.id)).views.has(FACILITY_MANAGE_VIEW);
  if (!mayView) { res.status(403).json({ message: 'Forbidden' }); return; }

  // The id comes from the stored list, never straight from the URL, so it can't point outside the folder.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(FACILITY_ATTACHMENTS_DIR, file.id), { headers: { 'Content-Type': file.mime } });
}

/**
 * Move an issue (In progress / Resolved / back to Open) and/or update the
 * note the reporter sees — facility managers. Resolving stamps resolvedAt;
 * reopening clears it.
 */
export async function updateFacilityIssueStatus(req: Request, res: Response): Promise<void> {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await loadOne(req.params.id);
  if (!existing) { res.status(404).json({ message: 'Facility issue not found' }); return; }

  const { status } = parsed.data;
  const note = parsed.data.note === undefined ? undefined : (parsed.data.note || null);
  const moves = status !== existing.status;
  const notes = note !== undefined && note !== existing.statusNote;
  if (!moves && !notes) { res.status(400).json({ message: 'Change the status or the note' }); return; }

  const now = new Date();
  await db.update(facilityIssues).set({
    status,
    ...(note !== undefined ? { statusNote: note } : {}),
    ...(moves ? { resolvedAt: status === 'RESOLVED' ? now : null } : {}),
    statusUpdatedByName: await nameOf(req.user!.id, req.user!.email),
    statusUpdatedAt: now,
    updatedAt: now,
  }).where(eq(facilityIssues.id, existing.id));
  res.json(await loadOne(existing.id));
}
