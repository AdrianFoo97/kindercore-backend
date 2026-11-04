import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { staffJoinRequests, teachers, users } from '../db/schema.js';
import { hireCandidateSchema } from '../validators/candidate.validator.js';
import { createStaffRecord, StaffRecordError, type NewStaffDetails } from '../services/staffRecord.service.js';

// New staff who joined without going through Recruitment fill in the public
// "New staff" form; HR approves (→ staff record, same as Recruitment → Hire)
// or rejects it under HR → New Staff.

const MAX_NOTE_LENGTH = 2000;
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

/** The kindergarten's calendar day (Malaysia, UTC+8). */
function todayInMalaysia(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const submitSchema = z.object({
  fullName: z.string().trim().min(2).max(191),
  phone: z.string().trim().min(8).max(50),
  dob: dateString,
  email: z.string().trim().toLowerCase().email().max(191),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  /** Honeypot — hidden on the form; bots fill it, people don't. */
  company: z.string().max(0, 'Honeypot triggered').optional(),
}).refine(d => d.dob < todayInMalaysia(), { message: 'Date of birth must be in the past.', path: ['dob'] });

const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: 'Validation error', errors: error.errors });

async function reviewerName(userId: string, fallback: string): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name ?? fallback;
}

// ── Public: submit the form ─────────────────────────────────────────────────
export async function submitStaffJoin(req: Request, res: Response): Promise<void> {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const d = parsed.data;

  // One open request per phone — a second tap or a resubmission shouldn't
  // put the same person in HR's queue twice.
  const [open] = await db.select({ id: staffJoinRequests.id }).from(staffJoinRequests)
    .where(and(eq(staffJoinRequests.phone, d.phone), eq(staffJoinRequests.status, 'PENDING')));
  if (open) {
    res.status(409).json({ message: 'We already have your details — HR will be in touch.' });
    return;
  }

  await db.insert(staffJoinRequests).values({
    id: randomUUID(),
    fullName: d.fullName,
    phone: d.phone,
    dob: d.dob,
    email: d.email,
    note: d.note || null,
    status: 'PENDING',
    createdAt: new Date(),
  });
  // Nothing is echoed back — it's a public endpoint.
  res.status(201).json({ ok: true });
}

// ── HR: the queue ───────────────────────────────────────────────────────────
export async function listStaffJoins(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(staffJoinRequests).orderBy(desc(staffJoinRequests.createdAt));
  res.json(rows);
}

// ── HR: approve → staff record ──────────────────────────────────────────────
export async function approveStaffJoin(req: Request, res: Response): Promise<void> {
  const parsed = hireCandidateSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const { id } = req.params;
  const reviewer = await reviewerName(req.user!.id, req.user!.email);

  let outcome: { status: number; message: string } | { teacherId: string };
  try {
    outcome = await db.transaction(async (tx) => {
      // Lock the request so two HR clicks can't create two staff records.
      const [request] = await tx.select().from(staffJoinRequests).where(eq(staffJoinRequests.id, id)).for('update');
      if (!request) return { status: 404, message: 'Request not found' };
      if (request.status !== 'PENDING') return { status: 409, message: 'This request has already been reviewed.' };

      // hireCandidateSchema has already enforced the required fields.
      const details = parsed.data as Omit<NewStaffDetails, 'name' | 'dob'>;
      const teacherId = await createStaffRecord(tx, { ...details, name: request.fullName, dob: request.dob });
      await tx.update(staffJoinRequests).set({
        status: 'APPROVED',
        teacherId,
        reviewedByUserId: req.user!.id,
        reviewedByName: reviewer,
        reviewedAt: new Date(),
      }).where(eq(staffJoinRequests.id, id));
      return { teacherId };
    });
  } catch (err) {
    if (err instanceof StaffRecordError) { res.status(400).json({ message: err.message }); return; }
    throw err;
  }

  if ('status' in outcome) { res.status(outcome.status).json({ message: outcome.message }); return; }
  const [request] = await db.select().from(staffJoinRequests).where(eq(staffJoinRequests.id, id));
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, outcome.teacherId));
  res.status(201).json({ request, teacher });
}

// ── HR: reject ──────────────────────────────────────────────────────────────
export async function rejectStaffJoin(req: Request, res: Response): Promise<void> {
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const { id } = req.params;

  const [request] = await db.select().from(staffJoinRequests).where(eq(staffJoinRequests.id, id));
  if (!request) { res.status(404).json({ message: 'Request not found' }); return; }
  if (request.status !== 'PENDING') { res.status(409).json({ message: 'This request has already been reviewed.' }); return; }

  await db.update(staffJoinRequests).set({
    status: 'REJECTED',
    rejectionReason: parsed.data.reason || null,
    reviewedByUserId: req.user!.id,
    reviewedByName: await reviewerName(req.user!.id, req.user!.email),
    reviewedAt: new Date(),
  }).where(eq(staffJoinRequests.id, id));
  const [updated] = await db.select().from(staffJoinRequests).where(eq(staffJoinRequests.id, id));
  res.json(updated);
}
