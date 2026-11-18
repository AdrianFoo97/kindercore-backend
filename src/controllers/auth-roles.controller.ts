import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { authRoles, authRoleModules, authRoleViews, positions, users } from '../db/schema.js';
import { ALL_MODULE_KEYS } from '../constants/authModules.js';
import { ACCESS_FUNCTIONS, ACCESS_FUNCTION_KEYS, BUILT_IN_ROLES, MODULE_INCLUDES, isBuiltInRoleId } from '../constants/accessRoles.js';

const BUILT_IN_LOCKED = 'Built-in roles can’t be changed — make a copy to build your own version.';

/** Refuses changes to a built-in role (they live in code). True when it answered. */
function refuseBuiltIn(id: string, res: Response): boolean {
  if (!isBuiltInRoleId(id)) return false;
  res.status(400).json({ message: BUILT_IN_LOCKED });
  return true;
}

/** How many people and positions hold each role. */
async function roleUsage(): Promise<{ people: Map<string, number>; positions: Map<string, number> }> {
  const count = (rows: { id: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.id) m.set(r.id, (m.get(r.id) ?? 0) + 1);
    return m;
  };
  const [u, p] = await Promise.all([
    db.select({ id: users.authRoleId }).from(users),
    db.select({ id: positions.authRoleId }).from(positions),
  ]);
  return { people: count(u), positions: count(p) };
}

/** GET /auth-roles/catalog — the modules and functions a role can grant. */
export async function getAuthRoleCatalog(_req: Request, res: Response): Promise<void> {
  res.json({ modules: ALL_MODULE_KEYS, functions: ACCESS_FUNCTIONS, moduleIncludes: MODULE_INCLUDES });
}

export async function listAuthRoles(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(authRoles).orderBy(asc(authRoles.sortOrder));

  // One extra query each for modules/views, grouped in JS — same idiom as
  // listTemplates' category attachment. The AuthRole count is small (one
  // per distinct access tier the org actually has), so this stays cheap.
  const modRows = await db.select({ authRoleId: authRoleModules.authRoleId, module: authRoleModules.module }).from(authRoleModules);
  const viewRows = await db.select({ authRoleId: authRoleViews.authRoleId, view: authRoleViews.view }).from(authRoleViews);

  const modulesByRole = new Map<string, string[]>();
  for (const r of modRows) {
    if (!modulesByRole.has(r.authRoleId)) modulesByRole.set(r.authRoleId, []);
    modulesByRole.get(r.authRoleId)!.push(r.module);
  }
  const viewsByRole = new Map<string, string[]>();
  for (const r of viewRows) {
    if (!viewsByRole.has(r.authRoleId)) viewsByRole.set(r.authRoleId, []);
    viewsByRole.get(r.authRoleId)!.push(r.view);
  }

  const usage = await roleUsage();
  const counts = (id: string) => ({ peopleCount: usage.people.get(id) ?? 0, positionCount: usage.positions.get(id) ?? 0 });
  res.json([
    ...BUILT_IN_ROLES.map((r, i) => ({
      id: r.id, name: r.name, description: r.description, area: r.area, sortOrder: i, builtIn: true,
      modules: r.modules, views: r.functions, ...counts(r.id),
    })),
    ...rows.map(r => ({
      ...r, area: null, builtIn: false,
      modules: modulesByRole.get(r.id) ?? [],
      views: viewsByRole.get(r.id) ?? [],
      ...counts(r.id),
    })),
  ]);
}

const upsertAuthRoleSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function createAuthRole(req: Request, res: Response): Promise<void> {
  const parsed = upsertAuthRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder == null) {
    const [{ max }] = await db.select({ max: sql<number>`COALESCE(MAX(${authRoles.sortOrder}), -1)` }).from(authRoles);
    sortOrder = (Number(max) ?? -1) + 1;
  }
  const id = randomUUID();
  await db.insert(authRoles).values({
    id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  res.json({ ...row, area: null, builtIn: false, modules: [], views: [], peopleCount: 0, positionCount: 0 });
}

const patchAuthRoleSchema = upsertAuthRoleSchema.partial();

export async function updateAuthRole(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (refuseBuiltIn(id, res)) return;
  const parsed = patchAuthRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  if (!existing) { res.status(404).json({ message: 'Access role not found' }); return; }
  await db.update(authRoles).set({ ...parsed.data, updatedAt: new Date() }).where(eq(authRoles.id, id));
  const [row] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  res.json(row);
}

export async function deleteAuthRole(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (refuseBuiltIn(id, res)) return;
  const [existing] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  if (!existing) { res.status(404).json({ message: 'Access role not found' }); return; }

  const [usage] = await db.select({ count: sql<number>`COUNT(*)` }).from(positions).where(eq(positions.authRoleId, id));
  if (usage && usage.count > 0) {
    res.status(409).json({ message: `Cannot delete — ${usage.count} position(s) assigned to this access role` });
    return;
  }
  const [people] = await db.select({ count: sql<number>`COUNT(*)` }).from(users).where(eq(users.authRoleId, id));
  if (people && people.count > 0) {
    res.status(409).json({ message: `Cannot delete — ${people.count} person(s) have this access role. Give them another role first.` });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(authRoleModules).where(eq(authRoleModules.authRoleId, id));
    await tx.delete(authRoleViews).where(eq(authRoleViews.authRoleId, id));
    await tx.delete(authRoles).where(eq(authRoles.id, id));
  });
  res.json({ ok: true });
}

const setModulesSchema = z.object({
  modules: z.array(z.enum(ALL_MODULE_KEYS as [string, ...string[]])),
});

// Full-replace, not incremental — same idiom as setTemplateCategories:
// delete everything this role currently has, insert exactly the deduped
// set the caller sent. modules/views are validated against the fixed
// code-level catalog (not free strings) so a stale/renamed key 400s
// clearly instead of writing garbage the middleware would never match.
export async function setAuthRoleModules(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (refuseBuiltIn(id, res)) return;
  const parsed = setModulesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  if (!existing) { res.status(404).json({ message: 'Access role not found' }); return; }
  const now = new Date();
  const moduleKeys = [...new Set(parsed.data.modules)];
  await db.transaction(async (tx) => {
    await tx.delete(authRoleModules).where(eq(authRoleModules.authRoleId, id));
    for (const module of moduleKeys) {
      await tx.insert(authRoleModules).values({ id: randomUUID(), authRoleId: id, module, createdAt: now });
    }
  });
  res.json({ ok: true });
}

const setViewsSchema = z.object({
  views: z.array(z.string().min(1).max(50)),
});

export async function setAuthRoleViews(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (refuseBuiltIn(id, res)) return;
  const parsed = setViewsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(authRoles).where(eq(authRoles.id, id));
  if (!existing) { res.status(404).json({ message: 'Access role not found' }); return; }
  const now = new Date();
  const viewKeys = [...new Set(parsed.data.views)];
  // Only functions the app really checks (constants/accessRoles.ts).
  const unknown = viewKeys.filter(v => !ACCESS_FUNCTION_KEYS.includes(v));
  if (unknown.length > 0) {
    res.status(400).json({ message: `Unknown function(s): ${unknown.join(', ')}` });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(authRoleViews).where(eq(authRoleViews.authRoleId, id));
    for (const view of viewKeys) {
      await tx.insert(authRoleViews).values({ id: randomUUID(), authRoleId: id, view, createdAt: now });
    }
  });
  res.json({ ok: true });
}
