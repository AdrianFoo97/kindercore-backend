import { Request, Response } from 'express';
import { z } from 'zod';
import { createNow, createSchedules, listSchedules, removeSchedule, staffInScope, startOneOff } from '../services/appraisalSchedules.service.js';
import { SCHEDULE_REPEATS } from '../services/appraisalSchedule.logic.js';
import { createdAppraisals } from '../services/appraisalRuns.service.js';
import { staffScopeFor } from '../services/performanceScope.service.js';
import { actor, send } from './appraisal-runs.controller.js';

// HRMS → Appraisal schedule: put staff on an appraisal form (repeating or
// once), take them off, or create this period's appraisal now. HR only — and
// only for the staff in your scope (your team, unless you may see everyone).

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

const scopeOf = (req: Request) => staffScopeFor({ id: req.user!.id, role: req.user!.role, teacherId: req.user!.teacherId ?? null });

export async function getAppraisalSchedules(req: Request, res: Response): Promise<void> {
  res.json(await listSchedules(await scopeOf(req)));
}

/** The appraisals the schedule has created, newest first. */
export async function getCreatedAppraisals(req: Request, res: Response): Promise<void> {
  res.json(await createdAppraisals(await scopeOf(req)));
}

/** Staff this person may schedule or observe — their team, or everyone. */
export async function getPerformanceStaff(req: Request, res: Response): Promise<void> {
  res.json(await staffInScope(await scopeOf(req)));
}

const createSchema = z.object({
  familyId: z.string().min(1).max(36),
  teacherIds: z.array(z.string().min(1).max(36)).min(1, 'Pick at least one staff member.').max(500),
  repeat: z.enum(SCHEDULE_REPEATS as [string, ...string[]]),
  dayOfMonth: z.number().int(),
  monthOfYear: z.number().int().nullable(),
  startsOn: z.string().max(10),
});

export async function createAppraisalSchedules(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  send(res, await createSchedules(parsed.data as never, req.user!.id, await scopeOf(req)), 201);
}

export async function deleteAppraisalSchedule(req: Request, res: Response): Promise<void> {
  send(res, await removeSchedule(req.params.id, await scopeOf(req)));
}

export async function createAppraisalNow(req: Request, res: Response): Promise<void> {
  const a = await actor(req);
  send(res, await createNow(req.params.id, { userId: a.userId, name: a.name }, a.scope), 201);
}

const oneOffSchema = z.object({
  teacherId: z.string().min(1).max(36),
  familyId: z.string().min(1).max(36),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(0).max(11),
  /** Start it even though they already have one this month (after the warning). */
  secondAnyway: z.boolean().default(false),
});

/** HRMS → Appraisals → New appraisal: start one for someone now, on a form, for a month. */
export async function startAppraisalOneOff(req: Request, res: Response): Promise<void> {
  const parsed = oneOffSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const a = await actor(req);
  const { teacherId, familyId, year, month, secondAnyway } = parsed.data;
  send(res, await startOneOff(teacherId!, familyId!, { year: year!, month: month! }, { userId: a.userId, name: a.name }, a.scope, secondAnyway), 201);
}