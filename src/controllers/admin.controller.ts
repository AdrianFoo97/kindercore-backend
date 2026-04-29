import { Request, Response } from 'express';
import { z } from 'zod';
import { rolloverYear, undoRolloverYear, repairStuckRollovers } from '../services/rollover.service.js';

// ── Year rollover ──────────────────────────────────────────────────────
// Admin-triggered transition from year N-1 to year N. See
// rollover.service.ts for the full semantics. Always returns the summary
// (created packages, rolled-over students, graduated, skipped) so the
// admin can audit the result before re-running or fixing data.

const rolloverSchema = z.object({
  /** Target year — students transition INTO this year. */
  year: z.number().int().min(2020).max(2100),
  /** When true, compute the summary without writing any rows. */
  dryRun: z.boolean().optional(),
});

export async function runYearRollover(req: Request, res: Response): Promise<void> {
  const parsed = rolloverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { year, dryRun } = parsed.data;
  const summary = await rolloverYear(year, { dryRun });
  res.json(summary);
}

const undoSchema = z.object({
  year: z.number().int().min(2020).max(2100),
});

export async function undoYearRollover(req: Request, res: Response): Promise<void> {
  const parsed = undoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const summary = await undoRolloverYear(parsed.data.year);
  res.json(summary);
}

const repairSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  dryRun: z.boolean().optional(),
});

export async function repairRollover(req: Request, res: Response): Promise<void> {
  const parsed = repairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { year, dryRun } = parsed.data;
  const summary = await repairStuckRollovers(year, { dryRun });
  res.json(summary);
}
