import type { Request, Response } from 'express';
import { z } from 'zod';
import { PublishError, publicationOverview, publishMonth, unpublishMonth } from '../services/profitSharePublish.service.js';
import { MAX_UNPUBLISH_REASON, MONTHS_IN_YEAR } from '../services/profitSharePublish.logic.js';

// Analysis → Profit Sharing → publish a month's pool for staff (Finance Manager).

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** The year + month in the address, or null when they aren't a real month. */
function monthFrom(req: Request): { year: number; month: number } | null {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || !Number.isInteger(month) || month < 0 || month >= MONTHS_IN_YEAR) return null;
  return { year, month };
}

export async function getPublications(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) { res.status(400).json({ message: 'Pick a valid year.' }); return; }
  res.json(await publicationOverview(year));
}

export async function postPublish(req: Request, res: Response): Promise<void> {
  const at = monthFrom(req);
  if (!at) { res.status(400).json({ message: 'Pick a valid month.' }); return; }
  try {
    await publishMonth(at.year, at.month, req.user!);
  } catch (e) {
    if (e instanceof PublishError) { res.status(409).json({ message: e.message }); return; }
    throw e;
  }
  res.json(await publicationOverview(at.year));
}

const unpublishSchema = z.object({ reason: z.string().max(MAX_UNPUBLISH_REASON) });

export async function postUnpublish(req: Request, res: Response): Promise<void> {
  const at = monthFrom(req);
  if (!at) { res.status(400).json({ message: 'Pick a valid month.' }); return; }
  const parsed = unpublishSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Say why it’s being taken back.' }); return; }
  try {
    await unpublishMonth(at.year, at.month, parsed.data.reason, req.user!);
  } catch (e) {
    if (e instanceof PublishError) { res.status(409).json({ message: e.message }); return; }
    throw e;
  }
  res.json(await publicationOverview(at.year));
}
