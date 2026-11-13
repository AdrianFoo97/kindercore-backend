import { Request, Response } from 'express';
import { z } from 'zod';
import { ACCESS_AREAS, RETENTION_DAYS, listAccessLog, type AccessArea } from '../services/accessLog.service.js';

const DEFAULT_DAYS = 30;
const AREA_KEYS = Object.keys(ACCESS_AREAS) as [AccessArea, ...AccessArea[]];

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(RETENTION_DAYS).default(DEFAULT_DAYS),
  area: z.enum(AREA_KEYS).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** Admin → Access Log: who opened pay, finance, appraisal and applicant records. Admin only. */
export async function getAccessLog(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ message: 'Invalid filters' }); return; }
  const { days, area, q, page } = parsed.data;
  const result = await listAccessLog({ days: days!, area, search: q, page: page! });
  res.json({ ...result, areas: ACCESS_AREAS, retentionDays: RETENTION_DAYS });
}
