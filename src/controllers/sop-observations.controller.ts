import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  sopObservations, sopObservationStepResults, sopSteps, sopTemplates, systemSettings, teachers, users,
} from '../db/schema.js';
import { OUTSIDE_TEAM, inStaffScope, staffScopeFor } from '../services/performanceScope.service.js';
import { formatDay, malaysiaToday } from '../services/appraisalSchedule.logic.js';
import { OBSERVATION_MARKING_KEY, certifyProblem, observationMarkingFrom, storedMarks, trainedOnProblem, type EnteredMark, type StepMark, type StoredMark } from '../services/sopTraining.logic.js';

// HRMS → Performance Management → Practice Observations: only for the staff in
// your scope — your team, unless your access role may see everyone.
const scopeOf = (req: Request) => staffScopeFor({ id: req.user!.id, role: req.user!.role, teacherId: req.user!.teacherId ?? null });
const outsideTeam = (res: Response) => { res.status(403).json({ message: OUTSIDE_TEAM }); };

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
  const scope = await scopeOf(req);
  res.json(rows.filter(r => inStaffScope(scope, r.teacherId)));
}

// ── Detail (header + joined step checklist) ─────────────────────────────────

export async function getObservation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [observation] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  if (!observation) { res.status(404).json({ message: 'Observation not found' }); return; }
  if (!inStaffScope(await scopeOf(req), observation.teacherId)) { outsideTeam(res); return; }

  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, observation.teacherId));
  const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, observation.sopTemplateId));
  const assignedTrainer = observation.trainerId
    ? (await db.select().from(teachers).where(eq(teachers.id, observation.trainerId)))[0]
    : null;

  const stepResults = await db.select({
    id: sopObservationStepResults.id,
    sopStepId: sopObservationStepResults.sopStepId,
    passed: sopObservationStepResults.passed,
    level: sopObservationStepResults.level,
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
  // Steps added to the guide after it was assigned are shown too (not marked yet) — until it's certified,
  // when what was marked is what stands. They're saved once they're marked (writeMarks).
  if (observation.status !== 'CERTIFIED') {
    const have = new Set(stepResults.map(r => r.sopStepId));
    const live = await db.select().from(sopSteps).where(and(eq(sopSteps.sopTemplateId, observation.sopTemplateId), isNull(sopSteps.deletedAt)));
    for (const s of live.filter(x => !have.has(x.id))) {
      stepResults.push({ id: `new:${s.id}`, sopStepId: s.id, passed: 'NA', level: null, note: null, section: s.section, title: s.title, detail: s.detail, displayOrder: s.displayOrder });
    }
    stepResults.sort((a, b) => a.displayOrder - b.displayOrder);
  }

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
  if (!teacher.isActive) { res.status(400).json({ message: `${teacher.name} is no longer active.` }); return; }
  if (!inStaffScope(await scopeOf(req), teacher.id)) { outsideTeam(res); return; }
  const [template] = await db.select().from(sopTemplates)
    .where(and(eq(sopTemplates.id, parsed.data.sopTemplateId), isNull(sopTemplates.deletedAt)));
  if (!template) { res.status(400).json({ message: 'How-To Guide does not exist' }); return; }
  const [trainer] = await db.select().from(teachers).where(eq(teachers.id, parsed.data.trainerId));
  if (!trainer) { res.status(400).json({ message: 'Assigned trainer does not exist' }); return; }
  if (!trainer.isActive) { res.status(400).json({ message: `${trainer.name} is no longer active, so can't train anyone.` }); return; }
  const steps = await db.select({ id: sopSteps.id }).from(sopSteps)
    .where(and(eq(sopSteps.sopTemplateId, parsed.data.sopTemplateId), isNull(sopSteps.deletedAt)));
  if (steps.length === 0) { res.status(400).json({ message: `"${template.title}" has no steps yet — add its steps before assigning training.` }); return; }
  const [open] = await db.select({ id: sopObservations.id }).from(sopObservations).where(and(
    eq(sopObservations.teacherId, teacher.id), eq(sopObservations.sopTemplateId, template.id), ne(sopObservations.status, 'CERTIFIED'),
  ));
  if (open) { res.status(409).json({ message: `${teacher.name} already has "${template.title}" training in progress.` }); return; }

  const now = new Date();
  const id = randomUUID();
  // How its steps are marked: the setting as it is now (later changes don't touch it).
  const [markingSetting] = await db.select().from(systemSettings).where(eq(systemSettings.key, OBSERVATION_MARKING_KEY));
  const marking = observationMarkingFrom(markingSetting?.value);
  await db.insert(sopObservations).values({
    id,
    marking: marking.inputType === 'LEVELS' ? marking : null,
    teacherId: parsed.data.teacherId,
    sopTemplateId: parsed.data.sopTemplateId,
    trainerId: parsed.data.trainerId ?? null,
    status: 'PENDING_TRAINER',
    createdAt: now,
    updatedAt: now,
  });

  // Pre-create one result row (NA) per active step so the checklist is
  // ready for the assessor to mark.
  const activeSteps = steps;
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
  // Pass / fail / N/A — or, for an observation marked on levels, the level's position (-1 = N/A).
  passed: z.enum(['PASS', 'FAIL', 'NA']).optional(),
  level: z.number().int().min(-1).nullable().optional(),
  note: z.string().nullable().optional(),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Save each step's mark: its row, or a new one for a step added to the guide since the observation was assigned. */
async function writeMarks(tx: Tx, observationId: string, marks: StoredMark[], now: Date) {
  const existing = new Set((await tx.select({ stepId: sopObservationStepResults.sopStepId }).from(sopObservationStepResults)
    .where(eq(sopObservationStepResults.observationId, observationId))).map(r => r.stepId));
  for (const m of marks) {
    if (existing.has(m.stepId)) {
      await tx.update(sopObservationStepResults).set({ passed: m.passed, level: m.level, note: m.note, updatedAt: now })
        .where(and(eq(sopObservationStepResults.observationId, observationId), eq(sopObservationStepResults.sopStepId, m.stepId)));
    } else {
      await tx.insert(sopObservationStepResults).values({ id: randomUUID(), observationId, sopStepId: m.stepId, passed: m.passed, level: m.level, note: m.note, createdAt: now, updatedAt: now });
    }
  }
}

/** The marks to store for this observation (levels become pass / fail against its pass mark) — or why they can't be. */
const marksFor = (obs: { marking: unknown }, entered: EnteredMark[]) => storedMarks(observationMarkingFrom(obs.marking), entered);

/** Every step marked is one of the guide's steps (a new row is only ever for its own steps). */
async function stepsBelong(sopTemplateId: string, entered: { stepId: string }[]): Promise<boolean> {
  if (entered.length === 0) return true;
  const steps = await db.select({ id: sopSteps.id }).from(sopSteps).where(eq(sopSteps.sopTemplateId, sopTemplateId));
  const ids = new Set(steps.map(s => s.id));
  return entered.every(e => ids.has(e.stepId));
}

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
  if (!inStaffScope(await scopeOf(req), existing.teacherId)) { outsideTeam(res); return; }

  if (req.user!.teacherId && req.user!.teacherId === existing.teacherId) { res.status(403).json({ message: 'You can’t sign off your own training.' }); return; }
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
    const resolved = marksFor(existing, data.stepResults as EnteredMark[]);
    if ('problem' in resolved) { res.status(400).json({ message: resolved.problem }); return; }
    if (!(await stepsBelong(existing.sopTemplateId, resolved.marks))) { res.status(400).json({ message: 'A step isn’t part of this guide.' }); return; }
    // Judge every step: the marks sent now over the ones already saved.
    const saved = await db.select({ stepId: sopObservationStepResults.sopStepId, passed: sopObservationStepResults.passed }).from(sopObservationStepResults).where(eq(sopObservationStepResults.observationId, id));
    const all = new Map<string, StepMark>(saved.map(s => [s.stepId, s.passed as StepMark]));
    for (const r of resolved.marks) all.set(r.stepId, r.passed);
    const problem = certifyProblem([...all.values()]);
    if (problem) { res.status(400).json({ message: problem }); return; }
    // Who certified it is whoever is signed in — not a name the browser sends.
    update.assessorName = (await signedInName(req)) ?? data.assessorName;
    update.assessorAt = new Date(data.assessorAt);
    if (data.notes !== undefined) update.notes = data.notes;
    await db.transaction(async (tx) => { await writeMarks(tx, id, resolved.marks, now); });
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
  if (!inStaffScope(await scopeOf(req), existing.teacherId)) { outsideTeam(res); return; }
  if (existing.status !== 'PENDING_ASSESSOR') {
    res.status(409).json({ message: 'Step results can only be saved while pending assessor review' });
    return;
  }

  const resolved = marksFor(existing, parsed.data.stepResults as EnteredMark[]);
  if ('problem' in resolved) { res.status(400).json({ message: resolved.problem }); return; }
  if (!(await stepsBelong(existing.sopTemplateId, resolved.marks))) { res.status(400).json({ message: 'A step isn’t part of this guide.' }); return; }
  const now = new Date();
  await db.transaction(async (tx) => {
    await writeMarks(tx, id, resolved.marks, now);
    await tx.update(sopObservations).set({ updatedAt: now }).where(eq(sopObservations.id, id));
  });

  res.json({ ok: true });
}

// ── My training (teacher app) ────────────────────────────────────────────────

/**
 * One staff member's training — SOP observations where they're the trainee,
 * and where they're the assigned trainer. Their own (or HR's view of them):
 * the route is guarded by selfOrModule(HR). Read-only, list-level.
 */
export async function getTeacherTraining(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  // Their own, or HR for staff in their scope (the same people HRMS → Practice Observations shows them).
  if (req.user!.teacherId !== teacherId && !inStaffScope(await scopeOf(req), teacherId)) { outsideTeam(res); return; }
  const rows = await db.select({
    id: sopObservations.id,
    teacherId: sopObservations.teacherId,
    teacherName: teachers.name,
    sopTemplateId: sopObservations.sopTemplateId,
    sopTitle: sopTemplates.title,
    trainerId: sopObservations.trainerId,
    trainerName: trainerTeachers.name,
    status: sopObservations.status,
    trainerAt: sopObservations.trainerAt,
    assessorAt: sopObservations.assessorAt,
    createdAt: sopObservations.createdAt,
  })
    .from(sopObservations)
    .innerJoin(teachers, eq(sopObservations.teacherId, teachers.id))
    .innerJoin(sopTemplates, eq(sopObservations.sopTemplateId, sopTemplates.id))
    .leftJoin(trainerTeachers, eq(sopObservations.trainerId, trainerTeachers.id))
    .where(or(eq(sopObservations.teacherId, teacherId), eq(sopObservations.trainerId, teacherId)))
    .orderBy(desc(sopObservations.createdAt));
  res.json({
    asTrainee: rows.filter(r => r.teacherId === teacherId),
    asTrainer: rows.filter(r => r.trainerId === teacherId),
  });
}

const trainedSchema = z.object({ trainedOn: z.string().max(10) });

/**
 * Teacher app → My training → Trainer: the assigned trainer records that they gave the
 * training (the day), and it moves on to the assessor. Their own (or HR's) — the route is
 * guarded by selfOrModule(HR); the observation must be one they're the trainer on.
 */
export async function recordTrainingGiven(req: Request, res: Response): Promise<void> {
  const { teacherId, observationId } = req.params;
  const parsed = trainedSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Pick the day the training was given.' }); return; }
  const problem = trainedOnProblem(parsed.data.trainedOn, formatDay(malaysiaToday()));
  if (problem) { res.status(400).json({ message: problem }); return; }
  const [obs] = await db.select().from(sopObservations).where(eq(sopObservations.id, observationId));
  if (!obs || obs.trainerId !== teacherId) { res.status(404).json({ message: 'Training not found' }); return; }
  // HR recording it for someone else: only for staff in their scope.
  if (req.user!.teacherId !== teacherId && !inStaffScope(await scopeOf(req), obs.teacherId)) { outsideTeam(res); return; }
  if (obs.status !== 'PENDING_TRAINER') { res.status(409).json({ message: 'This training is already recorded.' }); return; }
  const [trainer] = await db.select({ name: teachers.name }).from(teachers).where(eq(teachers.id, teacherId));
  const now = new Date();
  await db.update(sopObservations).set({
    status: 'PENDING_ASSESSOR', trainerName: trainer?.name ?? 'Trainer', trainerAt: new Date(`${parsed.data.trainedOn}T00:00:00Z`), updatedAt: now,
  }).where(and(eq(sopObservations.id, observationId), eq(sopObservations.status, 'PENDING_TRAINER')));
  res.json({ ok: true });
}

const signedInName = async (req: Request): Promise<string | null> =>
  (await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id)))[0]?.name ?? null;

const retrainSchema = z.object({ notes: z.string().max(2000).nullable().optional(), stepResults: z.array(stepResultInput) });

/**
 * The assessor found a step not done right: back to the trainer for more training
 * (the marks are kept so the trainer sees what failed). Same people as assessing.
 */
export async function sendBackForTraining(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = retrainSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  const [existing] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  if (!existing) { res.status(404).json({ message: 'Observation not found' }); return; }
  if (!inStaffScope(await scopeOf(req), existing.teacherId)) { outsideTeam(res); return; }
  if (req.user!.teacherId && req.user!.teacherId === existing.teacherId) { res.status(403).json({ message: 'You can’t sign off your own training.' }); return; }
  if (existing.status !== 'PENDING_ASSESSOR') { res.status(409).json({ message: 'Only training waiting to be assessed can be sent back.' }); return; }
  const resolved = marksFor(existing, parsed.data.stepResults as EnteredMark[]);
  if ('problem' in resolved) { res.status(400).json({ message: resolved.problem }); return; }
  if (!(await stepsBelong(existing.sopTemplateId, resolved.marks))) { res.status(400).json({ message: 'A step isn’t part of this guide.' }); return; }
  const now = new Date();
  await db.transaction(async tx => {
    await writeMarks(tx, id, resolved.marks, now);
    await tx.update(sopObservations).set({
      status: 'PENDING_TRAINER', trainerName: null, trainerAt: null, notes: parsed.data.notes ?? existing.notes, updatedAt: now,
    }).where(eq(sopObservations.id, id));
  });
  const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, id));
  res.json(row);
}

// ── Settings → Practice observations: how steps are marked (admins) ─────────
const levelSchema = z.object({ label: z.string().trim().min(1, 'Every level needs a name').max(40), score: z.number().min(0).max(100) });
const markingSchema = z.union([
  z.object({ inputType: z.literal('PASS_FAIL') }),
  z.object({
    inputType: z.literal('LEVELS'),
    levels: z.array(levelSchema).min(2, 'Give at least 2 levels').max(10, 'Use at most 10 levels')
      .refine(ls => new Set(ls.map(l => l.label.toLowerCase())).size === ls.length, 'Two levels have the same name'),
    passMark: z.number().min(0).max(100),
    source: z.object({ kind: z.enum(['SCALE', 'ONE_TO_FIVE', 'CUSTOM']), scaleId: z.string().max(36).optional() }).optional(),
  }).refine(m => m.levels.some(l => l.score >= m.passMark), 'The pass mark has to be one that a level reaches'),
]);

/** Save how new practice observations mark their steps (observations already assigned keep theirs). */
export async function saveObservationMarking(req: Request, res: Response): Promise<void> {
  const parsed = markingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Validation error', errors: parsed.error.errors }); return; }
  const now = new Date();
  await db.insert(systemSettings).values({ id: randomUUID(), key: OBSERVATION_MARKING_KEY, value: parsed.data, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: parsed.data, updatedAt: now } });
  res.json(parsed.data);
}
