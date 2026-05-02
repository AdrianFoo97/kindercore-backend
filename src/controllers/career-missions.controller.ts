import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  careerMissions, teacherMissionProgress, positions, teachers, careerRecords, missionCategories,
} from '../db/schema.js';
import { computeAverageAppraisal, APPRAISAL_PASS_THRESHOLD } from './teacher-appraisals.controller.js';

const DIFFICULTIES = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const;
const STATUSES = ['PENDING', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED'] as const;

// Category is now admin-managed — validate against the live MissionCategory
// table rather than a hardcoded enum.
async function assertCategoryExists(code: string): Promise<boolean> {
  const [row] = await db.select({ code: missionCategories.code })
    .from(missionCategories)
    .where(eq(missionCategories.code, code));
  return !!row;
}

// ── Mission CRUD ─────────────────────────────────────────────────────────────

export async function listMissions(req: Request, res: Response): Promise<void> {
  const { positionId } = req.query;
  // Always filter out soft-deleted missions for the admin list. Historical
  // progress rows can still resolve a deleted mission via direct join.
  const where = positionId
    ? and(eq(careerMissions.positionId, String(positionId)), isNull(careerMissions.deletedAt))
    : isNull(careerMissions.deletedAt);
  const rows = await db.select().from(careerMissions).where(where).orderBy(asc(careerMissions.positionId), asc(careerMissions.displayOrder));
  res.json(rows);
}

const upsertMissionSchema = z.object({
  positionId: z.string().min(1).max(10),
  title: z.string().min(1).max(191),
  category: z.string().min(1).max(50),
  description: z.string().nullable().optional(),
  whyItMatters: z.string().nullable().optional(),
  difficulty: z.enum(DIFFICULTIES).default('BASIC'),
  evidenceRequirements: z.string().nullable().optional(),
  required: z.boolean().default(true),
  highPriority: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  displayOrder: z.number().int().min(0).optional(),
});

async function assertPositionExists(positionId: string): Promise<boolean> {
  const [row] = await db.select({ id: positions.positionId }).from(positions).where(eq(positions.positionId, positionId));
  return !!row;
}

export async function createMission(req: Request, res: Response): Promise<void> {
  const parsed = upsertMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  if (!(await assertPositionExists(parsed.data.positionId))) {
    res.status(400).json({ message: 'Position does not exist' });
    return;
  }
  if (!(await assertCategoryExists(parsed.data.category))) {
    res.status(400).json({ message: `Category "${parsed.data.category}" does not exist` });
    return;
  }
  const now = new Date();
  // Auto-append: if displayOrder not provided, place at the end.
  let displayOrder = parsed.data.displayOrder;
  if (displayOrder == null) {
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${careerMissions.displayOrder}), -1)` })
      .from(careerMissions)
      .where(and(eq(careerMissions.positionId, parsed.data.positionId), isNull(careerMissions.deletedAt)));
    displayOrder = (Number(max) ?? -1) + 1;
  }
  const id = randomUUID();
  await db.insert(careerMissions).values({
    id,
    positionId: parsed.data.positionId,
    title: parsed.data.title,
    category: parsed.data.category,
    description: parsed.data.description ?? null,
    whyItMatters: parsed.data.whyItMatters ?? null,
    difficulty: parsed.data.difficulty,
    evidenceRequirements: parsed.data.evidenceRequirements ?? null,
    required: parsed.data.required,
    highPriority: parsed.data.highPriority,
    requiresApproval: parsed.data.requiresApproval,
    displayOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(careerMissions).where(eq(careerMissions.id, id));
  res.json(row);
}

const patchMissionSchema = upsertMissionSchema.partial().extend({
  positionId: z.string().min(1).max(10).optional(),
});

export async function updateMission(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(careerMissions).where(eq(careerMissions.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ message: 'Mission not found' });
    return;
  }
  if (parsed.data.positionId && !(await assertPositionExists(parsed.data.positionId))) {
    res.status(400).json({ message: 'Position does not exist' });
    return;
  }
  await db.update(careerMissions).set({ ...parsed.data, updatedAt: new Date() }).where(eq(careerMissions.id, id));
  const [row] = await db.select().from(careerMissions).where(eq(careerMissions.id, id));
  res.json(row);
}

// Soft-delete: keep the row so historical TeacherMissionProgress rows can
// still display the mission name. Archived missions are filtered out of the
// admin list and the teacher's active mission board.
export async function deleteMission(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(careerMissions).where(eq(careerMissions.id, id));
  if (!existing) { res.status(404).json({ message: 'Mission not found' }); return; }
  await db.update(careerMissions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(careerMissions.id, id));
  res.json({ ok: true });
}

const reorderSchema = z.object({
  positionId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)),
});

export async function reorderMissions(req: Request, res: Response): Promise<void> {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx.update(careerMissions)
        .set({ displayOrder: i, updatedAt: now })
        .where(and(eq(careerMissions.id, parsed.data.orderedIds[i]), eq(careerMissions.positionId, parsed.data.positionId)));
    }
  });
  res.json({ ok: true });
}

// ── Teacher career view ──────────────────────────────────────────────────────

// Returns everything the Teacher Career Page needs in one call: the teacher's
// current+next position, missions for the current position, progress, and
// the explicit blockers + next-position requirements that drive the redesign.
export async function getTeacherCareer(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  if (!teacher) { res.status(404).json({ message: 'Teacher not found' }); return; }

  const allPositions = await db.select().from(positions).orderBy(asc(positions.titleWeight));
  // Career-progression positions only. Used for the Journey Map and for
  // determining the next promotion target. Non-progression roles like
  // "Staff" are configured on the Position itself and excluded here.
  const ladder = allPositions.filter(p => p.inCareerProgression);

  const currentPosition = teacher.positionId
    ? allPositions.find(p => p.positionId === teacher.positionId) ?? null
    : null;
  const isCurrentInLadder = currentPosition?.inCareerProgression ?? false;

  // "Next" follows the ladder. If current isn't on the ladder, next is the
  // first ladder rung above the current titleWeight.
  const nextPosition = currentPosition
    ? ladder.find(p => p.titleWeight > currentPosition.titleWeight) ?? null
    : ladder[0] ?? null;

  // Mission scope: current position + every position above it on the
  // ladder (future promotions). Future-position missions render on the
  // Mission Board as optional "head-start" work — completing them now
  // counts toward those future positions' achievements when the teacher
  // gets there (progress is keyed by missionId, not by position).
  const futureLadderIds = currentPosition && isCurrentInLadder
    ? ladder.filter(p => p.titleWeight > currentPosition.titleWeight).map(p => p.positionId)
    : [];
  const missionScopeIds = currentPosition
    ? [currentPosition.positionId, ...futureLadderIds]
    : [];

  const missions = missionScopeIds.length > 0
    ? await db.select().from(careerMissions)
        .where(and(
          isNull(careerMissions.deletedAt),
          sql`${careerMissions.positionId} IN (${sql.join(missionScopeIds.map(id => sql`${id}`), sql`, `)})`,
        ))
        .orderBy(asc(careerMissions.displayOrder))
    : [];

  const progressRows = missions.length > 0
    ? await db.select().from(teacherMissionProgress)
        .where(and(
          eq(teacherMissionProgress.teacherId, teacherId),
          sql`${teacherMissionProgress.missionId} IN (${sql.join(missions.map(m => sql`${m.id}`), sql`, `)})`,
        ))
    : [];
  const progressByMission = new Map(progressRows.map(r => [r.missionId, r]));

  // Build a position lookup so we can decorate each mission with the
  // human-readable position name for the UI.
  const positionNameById = new Map(allPositions.map(p => [p.positionId, p.name]));
  const missionsWithProgress = missions.map(m => ({
    ...m,
    progress: progressByMission.get(m.id) ?? null,
    positionName: positionNameById.get(m.positionId) ?? null,
  }));

  // Readiness logic uses CURRENT position required missions ONLY — future
  // missions don't gate today's promotion.
  const currentPositionMissions = missionsWithProgress.filter(
    m => currentPosition && m.positionId === currentPosition.positionId,
  );

  // Career history (position changes). Sorted oldest → newest.
  const history = await db.select().from(careerRecords)
    .where(eq(careerRecords.teacherId, teacherId))
    .orderBy(asc(careerRecords.effectiveDate));

  // Mission readiness — derived from CURRENT-position required missions
  // only. Future-position missions are visible on the Mission Board as
  // optional preparation but never gate today's promotion review.
  const completedRequired = currentPositionMissions.filter(m => m.required && m.progress?.status === 'COMPLETED').length;
  const totalRequired = currentPositionMissions.filter(m => m.required).length;
  const inProgressRequired = currentPositionMissions.filter(m => m.required && (m.progress?.status === 'IN_PROGRESS' || m.progress?.status === 'UNDER_REVIEW')).length;
  const missionPct = totalRequired === 0 ? 0 : Math.round((completedRequired / totalRequired) * 100);
  const incompleteRequired = totalRequired - completedRequired;

  // Mocked criteria — these are not yet wired to source modules. Each ships
  // with a clear `mock: true` flag so the frontend can badge them.
  const APPRAISAL_REQUIRED = APPRAISAL_PASS_THRESHOLD;
  const SAFETY_REQUIRED = 80;
  const missionsMet = totalRequired > 0 && completedRequired === totalRequired;

  // Average appraisal — real data, not mocked. Computed from the most
  // recent monthly appraisal records. Null until any have been recorded.
  const appraisalSummary = await computeAverageAppraisal(teacherId);
  const appraisalMet = appraisalSummary.average !== null && appraisalSummary.average >= APPRAISAL_REQUIRED;

  // Promotion is gated by 3 things only: required missions, average appraisal,
  // and supervisor approval. Safety/SOP are tracked for awareness but not
  // listed as scored gates (we surface them in the optional info panel).
  const blockers: string[] = [];
  if (!currentPosition) blockers.push('No position assigned yet — assign one to start tracking progression.');
  else if (!isCurrentInLadder) blockers.push(`${currentPosition.name} isn't part of the career progression ladder.`);
  else if (!nextPosition) {} // final stage — handled below, not a blocker
  else {
    if (totalRequired === 0) blockers.push('No required missions configured for this position yet.');
    else if (incompleteRequired > 0) {
      blockers.push(`${incompleteRequired} required mission${incompleteRequired === 1 ? '' : 's'} incomplete`);
    }
    if (!appraisalMet) {
      blockers.push(appraisalSummary.average === null
        ? 'Appraisal not yet evaluated'
        : `Average appraisal below ${APPRAISAL_REQUIRED}% (currently ${appraisalSummary.average}%)`);
    }
    blockers.push('Supervisor approval pending');
  }

  // The "what does it take to reach NextPosition" list — used by the
  // Journey Map's hover/expand state and the Promotion Readiness panel.
  const nextPositionRequirements: string[] = nextPosition && currentPosition && isCurrentInLadder
    ? [
      totalRequired > 0
        ? `Complete all ${totalRequired} required ${currentPosition.name} mission${totalRequired === 1 ? '' : 's'}`
        : `Complete all required ${currentPosition.name} missions`,
      `Appraisal score ≥ ${APPRAISAL_REQUIRED}%`,
      `Safety score ≥ ${SAFETY_REQUIRED}%`,
      'SOP compliance: passed',
      'Supervisor approval',
    ]
    : [];

  const readiness = {
    missions: {
      completed: completedRequired,
      total: totalRequired,
      inProgress: inProgressRequired,
      met: missionsMet,
    },
    appraisal: {
      value: appraisalSummary.average,
      required: APPRAISAL_REQUIRED,
      met: appraisalMet,
      mock: false,
      recordCount: appraisalSummary.recordCount,
      windowSize: appraisalSummary.windowSize,
    },
    safety: { value: null as number | null, required: SAFETY_REQUIRED, met: false, mock: true },
    sopCompliance: { passed: false, mock: true },
    supervisorApproval: { approved: false, mock: true },
    blockers,
    overallReady: false,
    isFinalStage: !!currentPosition && isCurrentInLadder && !nextPosition,
    isCurrentInLadder,
  };

  res.json({
    teacher: {
      id: teacher.id,
      name: teacher.name,
      color: teacher.color,
      positionId: teacher.positionId,
      level: teacher.level,
    },
    positions: allPositions,
    ladder,
    currentPosition,
    nextPosition,
    nextPositionRequirements,
    missions: missionsWithProgress,
    missionPct,
    history,
    readiness,
  });
}

// ── Teacher mission progress mutations ──────────────────────────────────────

const upsertProgressSchema = z.object({
  status: z.enum(STATUSES).optional(),
  evidenceCount: z.number().int().min(0).optional(),
  evidenceTotal: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
});

// Upsert progress for (teacher, mission). Creates the row if missing.
export async function upsertTeacherMissionProgress(req: Request, res: Response): Promise<void> {
  const { teacherId, missionId } = req.params;
  const parsed = upsertProgressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [mission] = await db.select().from(careerMissions).where(eq(careerMissions.id, missionId));
  if (!mission) { res.status(404).json({ message: 'Mission not found' }); return; }
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  if (!teacher) { res.status(404).json({ message: 'Teacher not found' }); return; }

  const now = new Date();
  const [existing] = await db.select().from(teacherMissionProgress)
    .where(and(eq(teacherMissionProgress.teacherId, teacherId), eq(teacherMissionProgress.missionId, missionId)));

  if (existing) {
    const update: Record<string, unknown> = { updatedAt: now };
    if (parsed.data.status !== undefined) {
      update.status = parsed.data.status;
      if (parsed.data.status === 'IN_PROGRESS' && !existing.startedAt) update.startedAt = now;
      if (parsed.data.status === 'UNDER_REVIEW') update.submittedAt = now;
      if (parsed.data.status === 'COMPLETED' && !existing.approvedAt) update.approvedAt = now;
    }
    if (parsed.data.evidenceCount !== undefined) update.evidenceCount = parsed.data.evidenceCount;
    if (parsed.data.evidenceTotal !== undefined) update.evidenceTotal = parsed.data.evidenceTotal;
    if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
    await db.update(teacherMissionProgress).set(update)
      .where(eq(teacherMissionProgress.id, existing.id));
  } else {
    const id = randomUUID();
    const status = parsed.data.status ?? 'PENDING';
    await db.insert(teacherMissionProgress).values({
      id,
      teacherId,
      missionId,
      status,
      evidenceCount: parsed.data.evidenceCount ?? 0,
      evidenceTotal: parsed.data.evidenceTotal ?? 0,
      notes: parsed.data.notes ?? null,
      startedAt: status === 'IN_PROGRESS' ? now : null,
      submittedAt: status === 'UNDER_REVIEW' ? now : null,
      approvedAt: status === 'COMPLETED' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const [row] = await db.select().from(teacherMissionProgress)
    .where(and(eq(teacherMissionProgress.teacherId, teacherId), eq(teacherMissionProgress.missionId, missionId)));
  res.json(row);
}
