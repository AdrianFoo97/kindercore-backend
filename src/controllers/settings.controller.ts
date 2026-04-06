import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.record(z.unknown()))]),
});

export async function getSettings(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(systemSettings).orderBy(asc(systemSettings.key));
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    const val = row.value;
    result[row.key] = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return val; } })() : val;
  }
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
  const val = parsed.data.value as any;

  // INSERT ... ON DUPLICATE KEY UPDATE (key has a UNIQUE constraint in DB)
  await db
    .insert(systemSettings)
    .values({ id: randomUUID(), key, value: val, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: val, updatedAt: now } });

  res.json({ key, value: parsed.data.value });
}
