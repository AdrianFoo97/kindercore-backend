import { Request, Response } from 'express';
import { z } from 'zod';
import { resolveGrants, isAdminRole } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import {
  acknowledgeRun, actorFor, approveRun, cancelRun, runDetail, saveScores, sendBackRun, submitRun, tasksFor,
  type Actor,
} from '../services/appraisalRuns.service.js';

// One appraisal done with a form (created by the appraisal schedule). The
// routes let HR (and anyone with the Operation module) in; the service then checks the person is actually on the
// step they're acting on (appraisalScoring.canActOnStage).

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

export async function actor(req: Request): Promise<Actor> {
  const user = req.user!;
  const isHr = isAdminRole(user.role) || (await resolveGrants(user.id)).modules.has(MODULES.HR);
  return actorFor({ id: user.id, role: user.role, teacherId: user.teacherId ?? null }, isHr);
}

/** Send a service result: a failure as its status + message, else the body. */
export function send(res: Response, result: unknown, status = 200) {
  if (result && typeof result === 'object' && 'error' in result && 'status' in result) {
    const f = result as { error: string; status: number; existingId?: string };
    res.status(f.status).json({ message: f.error, ...(f.existingId ? { existingId: f.existingId } : {}) });
    return;
  }
  if (result === 'ok') { res.status(204).end(); return; }
  res.status(status).json(result);
}

/** What's waiting for me: appraisals I score, sign off, or (my own) confirm. */
export async function getMyAppraisalTasks(req: Request, res: Response): Promise<void> {
  res.json(await tasksFor(await actor(req)));
}

export async function getAppraisalRun(req: Request, res: Response): Promise<void> {
  send(res, await runDetail(req.params.id, await actor(req)));
}

const scoresSchema = z.object({
  scores: z.array(z.object({
    criterionId: z.string().max(36),
    pointId: z.string().max(36).nullable().optional(),
    rawValue: z.number().nullable(),
    comment: z.string().trim().max(1000).nullable().optional(),
  })).max(500),
  comments: z.string().trim().max(5000).nullable().optional(),
});

export async function saveAppraisalRunScores(req: Request, res: Response): Promise<void> {
  const parsed = scoresSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  send(res, await saveScores(req.params.id, await actor(req), parsed.data.scores as never, parsed.data.comments || null));
}

export async function submitAppraisalRun(req: Request, res: Response): Promise<void> {
  send(res, await submitRun(req.params.id, await actor(req)));
}

export async function approveAppraisalRun(req: Request, res: Response): Promise<void> {
  send(res, await approveRun(req.params.id, await actor(req)));
}

const sendBackSchema = z.object({ reason: z.string().trim().min(1, 'Say what needs changing').max(1000) });

export async function sendBackAppraisalRun(req: Request, res: Response): Promise<void> {
  const parsed = sendBackSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  send(res, await sendBackRun(req.params.id, await actor(req), parsed.data.reason!));
}

export async function acknowledgeAppraisalRun(req: Request, res: Response): Promise<void> {
  send(res, await acknowledgeRun(req.params.id, await actor(req)));
}

export async function cancelAppraisalRun(req: Request, res: Response): Promise<void> {
  send(res, await cancelRun(req.params.id, await actor(req)));
}
