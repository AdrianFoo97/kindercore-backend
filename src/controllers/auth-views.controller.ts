import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { authViews, authViewModules, authRoleViews } from '../db/schema.js';
import { ALL_MODULE_KEYS } from '../constants/authModules.js';

export async function listAuthViews(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(authViews).orderBy(asc(authViews.label));

  // Same grouped-in-JS idiom as listAuthRoles' modules/views attachment —
  // the view count is small, so one extra query stays cheap.
  const moduleRows = await db.select({ authViewId: authViewModules.authViewId, module: authViewModules.module }).from(authViewModules);
  const modulesByView = new Map<string, string[]>();
  for (const r of moduleRows) {
    if (!modulesByView.has(r.authViewId)) modulesByView.set(r.authViewId, []);
    modulesByView.get(r.authViewId)!.push(r.module);
  }

  res.json(rows.map(r => ({ ...r, modules: modulesByView.get(r.id) ?? [] })));
}

// `key` is what a developer later hardcodes into requireView(...)/hasView(...)
// call sites — uppercase/underscore only, matching the existing
// OPERATION_SOP_APPROVE convention, so it reads the same as every other
// view key already in code.
const createAuthViewSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Uppercase letters, numbers, and underscores only — must start with a letter'),
  label: z.string().min(1).max(191),
  description: z.string().nullable().optional(),
  modules: z.array(z.enum(ALL_MODULE_KEYS as [string, ...string[]])).min(1, 'At least one module is required'),
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
  const moduleKeys = [...new Set(parsed.data.modules)];
  await db.transaction(async (tx) => {
    await tx.insert(authViews).values({
      id,
      key: parsed.data.key,
      label: parsed.data.label,
      description: parsed.data.description ?? null,
      createdAt: now,
      updatedAt: now,
    });
    for (const module of moduleKeys) {
      await tx.insert(authViewModules).values({ id: randomUUID(), authViewId: id, module, createdAt: now });
    }
  });
  const [row] = await db.select().from(authViews).where(eq(authViews.id, id));
  res.json({ ...row, modules: moduleKeys });
}

// `key` is deliberately not accepted here — it's immutable after creation.
// Renaming it later would silently break any requireView(...)/hasView(...)
// call site already hardcoded to the old string, with no error to signal
// the mismatch (a wrong/stale key just always resolves to "no access").
const updateAuthViewSchema = z.object({
  label: z.string().min(1).max(191).optional(),
  description: z.string().nullable().optional(),
  modules: z.array(z.enum(ALL_MODULE_KEYS as [string, ...string[]])).min(1, 'At least one module is required').optional(),
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

  const { modules, ...fields } = parsed.data;
  const now = new Date();
  await db.transaction(async (tx) => {
    if (Object.keys(fields).length > 0) {
      await tx.update(authViews).set({ ...fields, updatedAt: now }).where(eq(authViews.id, id));
    } else {
      await tx.update(authViews).set({ updatedAt: now }).where(eq(authViews.id, id));
    }
    // Full-replace, same idiom as setAuthRoleModules — only touch the join
    // rows when the caller actually sent a modules array.
    if (modules) {
      const moduleKeys = [...new Set(modules)];
      await tx.delete(authViewModules).where(eq(authViewModules.authViewId, id));
      for (const module of moduleKeys) {
        await tx.insert(authViewModules).values({ id: randomUUID(), authViewId: id, module, createdAt: now });
      }
    }
  });

  const [row] = await db.select().from(authViews).where(eq(authViews.id, id));
  const moduleRows = await db.select({ module: authViewModules.module }).from(authViewModules).where(eq(authViewModules.authViewId, id));
  res.json({ ...row, modules: moduleRows.map(m => m.module) });
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

  await db.transaction(async (tx) => {
    await tx.delete(authViewModules).where(eq(authViewModules.authViewId, id));
    await tx.delete(authViews).where(eq(authViews.id, id));
  });
  res.json({ ok: true });
}
