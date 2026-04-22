import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';
import { SYSTEM_LOST_REASON_LABELS } from '../constants/lostReasons.js';

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.record(z.unknown()))]),
});

// Enforce system-pinned lost reasons at the boundary: they always come first
// and can't be removed, whatever the client sent (or didn't send).
function normalizeLostReasons(value: unknown): string[] {
  const incoming = Array.isArray(value)
    ? value.map(v => String(v).trim()).filter(Boolean)
    : [];
  // Drop any duplicates of system labels from the user section.
  const userOnly = incoming.filter(r => !SYSTEM_LOST_REASON_LABELS.includes(r));
  // De-dupe while preserving order.
  const seen = new Set<string>();
  const deduped = userOnly.filter(r => (seen.has(r) ? false : (seen.add(r), true)));
  return [...SYSTEM_LOST_REASON_LABELS, ...deduped];
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(systemSettings).orderBy(asc(systemSettings.key));
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    const val = row.value;
    result[row.key] = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return val; } })() : val;
  }
  // Always surface the system lost reasons, even if the stored value is
  // missing, malformed, or was written before the constant existed.
  result.lost_reasons = normalizeLostReasons(result.lost_reasons);
  res.json(result);
}

export async function updateSetting(req: Request, res: Response): Promise<void> {
  const { key } = req.params;

  const parsed = updateSettingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const now = new Date();
  let val = parsed.data.value as any;
  if (key === 'lost_reasons') {
    val = normalizeLostReasons(val);
  }

  // INSERT ... ON DUPLICATE KEY UPDATE (key has a UNIQUE constraint in DB)
  await db
    .insert(systemSettings)
    .values({ id: randomUUID(), key, value: val, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: val, updatedAt: now } });

  res.json({ key, value: val });
}
