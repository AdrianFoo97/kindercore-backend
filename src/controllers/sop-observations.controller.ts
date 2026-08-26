import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  sopObservations, sopObservationStepResults, sopSteps, sopTemplates, teachers,
} from '../db/schema.js';

const STATUSES = ['PENDING_TRAINER', 'PENDING_ASSESSOR', 'CERTIFIED'] as const;

// Assigned trainer is also a Teacher row, joined a second time against the
// same table as the trainee — needs its own alias to disambiguate.
const trainerTeachers = alias(teachers, 'trainerTeachers');

// ── List (HR queue + per-teacher history) ───────────────────────────────────

export async function listObservations(req: Request, res: Response): Promise<void> {
  const { teacherId, status } = req.query;
  const conditions = [];
  if (teacherId) conditions.push(eq(sopObservations.teacherId, String(teacherId)));
  if (status) conditions.push(eq(sopObservations.status, String(status) as typeof STATUSES[number]));

  const rows = await db.select({
    id: sopObservations.id,
    teacherId: sopObservations.teacherId,
    teacherName: teachers.name,
    sopTemplateId: sopObservations.sopTemplateId,
    templateTitle: sopTemplates.title,
    trainerId: sopObservations.trainerId,
    assignedTrainerName: trainerTeachers.name,
    status: sopObservations.status,
    trainerName: sopObservations.trainerName,
    trainerAt: sopObservations.trainerAt,
    assessorName: sopObservations.assessorName,
    assessorAt: sopObservations.assessorAt,
    createdAt: sopObservations.createdAt,
    updatedAt: sopObservations.updatedAt,
  })
    .from(sopObservations)
    .innerJoin(teachers, eq(sopObservations.teacherId, teachers.id))
    .innerJoin(sopTemplates, eq(sopObservations.sopTemplateId, sopTemplates.id))
    .leftJoin(trainerTeachers, eq(sopObservations.trainerId, trainerTeachers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(sopObservations.createdAt));
  res.json(rows);
}

// ── Detail (header + joined step checklist) ─────────────────────────────────

export async function getObservation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [observation] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  if (!observation) { res.status(404).json({ message: 'Observation not found' }); return; }

  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, observation.teacherId));
  const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, observation.sopTemplateId));
  const assignedTrainer = observation.trainerId
    ? (await db.select().from(teachers).where(eq(teachers.id, observation.trainerId)))[0]
    : null;

  const stepResults = await db.select({
    id: sopObservationStepResults.id,
    sopStepId: sopObservationStepResults.sopStepId,
    passed: sopObservationStepResults.passed,
    note: sopObservationStepResults.note,
    section: sopSteps.section,
    title: sopSteps.title,
    detail: sopSteps.detail,
    displayOrder: sopSteps.displayOrder,
  })
    .from(sopObservationStepResults)
    .innerJoin(sopSteps, eq(sopObservationStepResults.sopStepId, sopSteps.id))
    .where(eq(sopObservationStepResults.observationId, id))
    .orderBy(asc(sopSteps.displayOrder));

  res.json({
    ...observation,
    teacherName: teacher?.name ?? null,
    templateTitle: template?.title ?? null,
    templateGoal: template?.goal ?? null,
    assignedTrainerName: assignedTrainer?.name ?? null,
    stepResults,
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

const createObservationSchema = z.object({
  teacherId: z.string().min(1).max(36),
  sopTemplateId: z.string().min(1).max(36),
  trainerId: z.string().min(1).max(36),
});

export async function createObservation(req: Request, res: Response): Promise<void> {
  const parsed = createObservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (parsed.data.trainerId === parsed.data.teacherId) {
    res.status(400).json({ message: 'The trainer cannot be the teacher being observed' });
    return;
  }
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, parsed.data.teacherId));
  if (!teacher) { res.status(400).json({ message: 'Teacher does not exist' }); return; }
  const [template] = await db.select().from(sopTemplates)
    .where(and(eq(sopTemplates.id, parsed.data.sopTemplateId), isNull(sopTemplates.deletedAt)));
  if (!template) { res.status(400).json({ message: 'How-To Guide does not exist' }); return; }
  const [trainer] = await db.select().from(teachers).where(eq(teachers.id, parsed.data.trainerId));
  if (!trainer) { res.status(400).json({ message: 'Assigned trainer does not exist' }); return; }

  const now = new Date();
  const id = randomUUID();
  await db.insert(sopObservations).values({
    id,
    teacherId: parsed.data.teacherId,
    sopTemplateId: parsed.data.sopTemplateId,
    trainerId: parsed.data.trainerId ?? null,
    status: 'PENDING_TRAINER',
    createdAt: now,
    updatedAt: now,
  });

  // Pre-create one result row (NA) per active step so the checklist is
  // ready for the assessor to mark.
  const activeSteps = await db.select({ id: sopSteps.id }).from(sopSteps)
    .where(and(eq(sopSteps.sopTemplateId, parsed.data.sopTemplateId), isNull(sopSteps.deletedAt)));
  if (activeSteps.length > 0) {
    await db.insert(sopObservationStepResults).values(activeSteps.map(s => ({
      id: randomUUID(),
      observationId: id,
      sopStepId: s.id,
      passed: 'NA' as const,
      createdAt: now,
      updatedAt: now,
    })));
  }

  const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  res.json(row);
}

// ── Advance stage ────────────────────────────────────────────────────────────
// One endpoint; the required payload shape depends on the observation's
// CURRENT status (re-read server-side, not trusted from the client, so two
// concurrent submissions can't double-advance the same row).

const stepResultInput = z.object({
  stepId: z.string().min(1),
  passed: z.enum(['PASS', 'FAIL', 'NA']),
  note: z.string().nullable().optional(),
});

const advanceSchemas: Record<typeof STATUSES[number], z.ZodTypeAny> = {
  // Trainer trains the employee using the checklist as a reference — they
  // don't mark it. Just confirms who ran the training and when.
  PENDING_TRAINER: z.object({
    trainerName: z.string().min(1).max(191),
    trainerAt: z.string().min(1),
  }),
  // Assessor is the one who actually marks each step PASS/FAIL/NA — the
  // checklist is their scoring instrument, not the trainer's.
  PENDING_ASSESSOR: z.object({
    assessorName: z.string().min(1).max(191),
    assessorAt: z.string().min(1),
    notes: z.string().nullable().optional(),
    stepResults: z.array(stepResultInput),
  }),
  CERTIFIED: z.never(),
};

const NEXT_STATUS: Record<typeof STATUSES[number], typeof STATUSES[number] | null> = {
  PENDING_TRAINER: 'PENDING_ASSESSOR',
  PENDING_ASSESSOR: 'CERTIFIED',
  CERTIFIED: null,
};

export async function advanceStage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  if (!existing) { res.status(404).json({ message: 'Observation not found' }); return; }

  const currentStatus = existing.status as typeof STATUSES[number];
  const nextStatus = NEXT_STATUS[currentStatus];
  if (!nextStatus) {
    res.status(409).json({ message: 'This observation is already certified' });
    return;
  }

  const schema = advanceSchemas[currentStatus];
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const now = new Date();
  const update: Record<string, unknown> = { status: nextStatus, updatedAt: now };

  if (currentStatus === 'PENDING_TRAINER') {
    const data = parsed.data as z.infer<typeof advanceSchemas.PENDING_TRAINER>;
    update.trainerName = data.trainerName;
    update.trainerAt = new Date(data.trainerAt);
  } else if (currentStatus === 'PENDING_ASSESSOR') {
    const data = parsed.data as z.infer<typeof advanceSchemas.PENDING_ASSESSOR>;
    update.assessorName = data.assessorName;
    update.assessorAt = new Date(data.assessorAt);
    if (data.notes !== undefined) update.notes = data.notes;
    await db.transaction(async (tx) => {
      for (const r of data.stepResults) {
        await tx.update(sopObservationStepResults)
          .set({ passed: r.passed, note: r.note ?? null, updatedAt: now })
          .where(and(eq(sopObservationStepResults.observationId, id), eq(sopObservationStepResults.sopStepId, r.stepId)));
      }
    });
  }

  await db.update(sopObservations).set(update).where(eq(sopObservations.id, id));
  const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  res.json(row);
}

// ── Save step-result marks as a draft (assessor only, doesn't advance) ──────
// Lets the assessor persist partial marking progress on a long checklist
// without committing to Certify yet — same step-result rows advanceStage
// writes to, just without the status transition or assessor name/date.

const draftStepResultsSchema = z.object({
  stepResults: z.array(stepResultInput),
});

export async function saveStepResultsDraft(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = draftStepResultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  if (!existing) { res.status(404).json({ message: 'Observation not found' }); return; }
  if (existing.status !== 'PENDING_ASSESSOR') {
    res.status(409).json({ message: 'Step results can only be saved while pending assessor review' });
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const r of parsed.data.stepResults) {
      await tx.update(sopObservationStepResults)
        .set({ passed: r.passed, note: r.note ?? null, updatedAt: now })
        .where(and(eq(sopObservationStepResults.observationId, id), eq(sopObservationStepResults.sopStepId, r.stepId)));
    }
    await tx.update(sopObservations).set({ updatedAt: now }).where(eq(sopObservations.id, id));
  });

  res.json({ ok: true });
}
