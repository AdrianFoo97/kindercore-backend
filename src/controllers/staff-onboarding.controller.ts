import { Request, Response } from 'express';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { positions, teachers } from '../db/schema.js';
import { applyTicks, freshStaffChecklist, freshStaffChecklists, isChecklistDone, parseChecklist } from '../services/staffOnboarding.service.js';

// HR → Onboarding: staff who are still working through their new-joiner
// checklist. Mirrors student onboarding (students.controller.ts) — tick tasks,
// then mark complete; "complete all" for someone already fully set up.

const MAX_TASKS = 50;
const MAX_TASK_LENGTH = 300;

const progressSchema = z.object({
  progress: z.array(z.object({
    task: z.string().trim().min(1).max(MAX_TASK_LENGTH),
    done: z.boolean(),
  })).max(MAX_TASKS),
});

export async function listStaffOnboarding(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      color: teachers.color,
      phone: teachers.phone,
      joinDate: teachers.createdAt,
      positionId: teachers.positionId,
      onboardingProgress: teachers.onboardingProgress,
      selfOnboardingProgress: teachers.selfOnboardingProgress,
    })
    .from(teachers)
    // Current staff only — someone who left or was removed mid-onboarding drops off.
    .where(and(eq(teachers.onboardingCompleted, false), eq(teachers.isActive, true), isNull(teachers.resignedAt)))
    .orderBy(asc(teachers.createdAt));
  // Position names looked up separately: Teacher.positionId and
  // Position.positionId have different collations, so MySQL refuses to join them.
  const positionNames = new Map((await db.select({ id: positions.positionId, name: positions.name }).from(positions)).map(p => [p.id, p.name]));
  res.json(rows.map(({ positionId, ...r }) => ({
    ...r,
    positionName: positionId ? positionNames.get(positionId) ?? null : null,
    onboardingProgress: parseChecklist(r.onboardingProgress),
    selfOnboardingProgress: parseChecklist(r.selfOnboardingProgress),
  })));
}

// ── The new joiner's own checklist ("My onboarding" in their app) ─────────
// Ticks only: the body is one true/false per task, so nobody can rewrite the
// tasks themselves. The teacher ticks their own; HR can tick for them.

const ticksSchema = z.object({ done: z.array(z.boolean()).max(MAX_TASKS) });

export async function getMyOnboarding(req: Request, res: Response): Promise<void> {
  const [t] = await db.select({ progress: teachers.selfOnboardingProgress }).from(teachers).where(eq(teachers.id, req.params.teacherId));
  if (!t) { res.status(404).json({ message: 'Staff member not found' }); return; }
  res.json({ tasks: parseChecklist(t.progress) });
}

export async function tickMyOnboarding(req: Request, res: Response): Promise<void> {
  const parsed = ticksSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  const { teacherId } = req.params;
  const [t] = await db.select({ progress: teachers.selfOnboardingProgress }).from(teachers).where(eq(teachers.id, teacherId));
  if (!t) { res.status(404).json({ message: 'Staff member not found' }); return; }

  const updated = applyTicks(parseChecklist(t.progress), parsed.data.done);
  if (!updated) { res.status(409).json({ message: 'The checklist has changed — reload and try again.' }); return; }
  await db.update(teachers).set({ selfOnboardingProgress: updated, updatedAt: new Date() }).where(eq(teachers.id, teacherId));
  res.json({ tasks: updated });
}

export async function saveStaffOnboarding(req: Request, res: Response): Promise<void> {
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  const { teacherId } = req.params;
  if (!(await staffExists(teacherId))) { res.status(404).json({ message: 'Staff member not found' }); return; }

  // Any edit puts them (back) on the onboarding list; only /complete takes them off.
  await db.update(teachers)
    .set({ onboardingProgress: parsed.data.progress, onboardingCompleted: false, updatedAt: new Date() })
    .where(eq(teachers.id, teacherId));
  res.json({ ok: true });
}

export async function completeStaffOnboarding(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const force = req.query.force === 'true';
  const [teacher] = await db.select({ progress: teachers.onboardingProgress, own: teachers.selfOnboardingProgress })
    .from(teachers).where(eq(teachers.id, teacherId));
  if (!teacher) { res.status(404).json({ message: 'Staff member not found' }); return; }

  let progress = parseChecklist(teacher.progress);
  let own = parseChecklist(teacher.own);
  if (force) {
    // "Complete all" — tick everything on both lists (HR's from the template if none was set up).
    if (progress.length === 0) progress = await freshStaffChecklist();
    progress = progress.map(t => ({ ...t, done: true }));
    own = own.map(t => ({ ...t, done: true }));
  } else if (!isChecklistDone(progress)) {
    res.status(400).json({ message: 'All HR tasks must be completed first' });
    return;
  } else if (!isChecklistDone(own)) {
    // Onboarding is done only when the new joiner has finished their own list too.
    res.status(400).json({ message: 'They still have tasks left on their own checklist' });
    return;
  }

  await db.update(teachers)
    .set({ onboardingProgress: progress, selfOnboardingProgress: own, onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(teachers.id, teacherId));
  res.json({ ok: true });
}

// Staff page → ⋯ → Create Onboarding Tasks: put an existing staff member
// (e.g. someone who joined before onboarding existed) on HR → Onboarding with
// fresh copies of both checklists. Same idea as Students → Create Onboarding Tasks.
export async function startStaffOnboarding(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  const [t] = await db.select({ completed: teachers.onboardingCompleted, isActive: teachers.isActive, resignedAt: teachers.resignedAt })
    .from(teachers).where(eq(teachers.id, teacherId));
  if (!t) { res.status(404).json({ message: 'Staff member not found' }); return; }
  if (!t.completed) { res.status(409).json({ message: 'Onboarding is already in progress' }); return; }
  if (!t.isActive || t.resignedAt) { res.status(409).json({ message: 'They are no longer on the staff list' }); return; }

  const checklists = await freshStaffChecklists();
  if (checklists.hr.length === 0) {
    res.status(400).json({ message: 'The HR checklist is empty. Add tasks in Settings → HR & Payroll → Staff Onboarding first.' });
    return;
  }
  await db.update(teachers).set({
    onboardingProgress: checklists.hr,
    selfOnboardingProgress: checklists.self,
    onboardingCompleted: false,
    updatedAt: new Date(),
  }).where(eq(teachers.id, teacherId));
  res.status(201).json({ hrTasks: checklists.hr.length, ownTasks: checklists.self.length });
}

async function staffExists(teacherId: string): Promise<boolean> {
  const [t] = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.id, teacherId));
  return !!t;
}
