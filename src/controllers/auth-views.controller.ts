import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { authViews, authRoleViews } from '../db/schema.js';
import { ALL_MODULE_KEYS } from '../constants/authModules.js';

export async function listAuthViews(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(authViews).orderBy(asc(authViews.module), asc(authViews.label));
  res.json(rows);
}

// `key` is what a developer later hardcodes into requireView(...)/hasView(...)
// call sites — uppercase/underscore only, matching the existing
// OPERATION_SOP_APPROVE convention, so it reads the same as every other
// view key already in code.
const createAuthViewSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Uppercase letters, numbers, and underscores only — must start with a letter'),
  label: z.string().min(1).max(191),
  description: z.string().nullable().optional(),
  module: z.enum(ALL_MODULE_KEYS as [string, ...string[]]),
});

export async function createAuthView(req: Request, res: Response): Promise<void> {
  const parsed = createAuthViewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select({ id: authViews.id }).from(authViews).where(eq(authViews.key, parsed.data.key));
  if (existing) {
    res.status(409).json({ message: `A view with key "${parsed.data.key}" already exists` });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(authViews).values({
    id,
    key: parsed.data.key,
    label: parsed.data.label,
    description: parsed.data.description ?? null,
    module: parsed.data.module,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(authViews).where(eq(authViews.id, id));
  res.json(row);
}

// `key` is deliberately not accepted here — it's immutable after creation.
// Renaming it later would silently break any requireView(...)/hasView(...)
// call site already hardcoded to the old string, with no error to signal
// the mismatch (a wrong/stale key just always resolves to "no access").
const updateAuthViewSchema = z.object({
  label: z.string().min(1).max(191).optional(),
  description: z.string().nullable().optional(),
  module: z.enum(ALL_MODULE_KEYS as [string, ...string[]]).optional(),
});

export async function updateAuthView(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateAuthViewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(authViews).where(eq(authViews.id, id));
  if (!existing) { res.status(404).json({ message: 'View not found' }); return; }
  await db.update(authViews).set({ ...parsed.data, updatedAt: new Date() }).where(eq(authViews.id, id));
  const [row] = await db.select().from(authViews).where(eq(authViews.id, id));
  res.json(row);
}

export async function deleteAuthView(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(authViews).where(eq(authViews.id, id));
  if (!existing) { res.status(404).json({ message: 'View not found' }); return; }

  const usageRows = await db.select({ id: authRoleViews.id }).from(authRoleViews).where(eq(authRoleViews.view, existing.key));
  if (usageRows.length > 0) {
    res.status(409).json({ message: `Cannot delete — ${usageRows.length} access role(s) still have this view assigned` });
    return;
  }

  await db.delete(authViews).where(eq(authViews.id, id));
  res.json({ ok: true });
}
