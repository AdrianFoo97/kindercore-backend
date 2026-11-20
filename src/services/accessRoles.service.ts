import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authRoleModules, authRoleViews, authRoles, positions, teachers, userAuthRoles, users } from '../db/schema.js';
import { isBuiltInRoleId, builtInRole } from '../constants/accessRoles.js';

/** Why this access role can't be given — or null when it can (null/empty = no role). */
export async function accessRoleProblem(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  if (isBuiltInRoleId(id)) return builtInRole(id) ? null : 'That access role doesn’t exist.';
  const [row] = await db.select({ id: authRoles.id }).from(authRoles).where(eq(authRoles.id, id));
  return row ? null : 'That access role doesn’t exist.';
}

/** The first problem with a list of roles to give someone, or null when they're all fine. */
export async function accessRolesProblem(ids: string[]): Promise<string | null> {
  for (const id of ids) {
    const problem = await accessRoleProblem(id);
    if (problem) return problem;
  }
  return null;
}

/** A person's own access roles (not counting their position's). */
export async function userRoleIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: userAuthRoles.authRoleId }).from(userAuthRoles).where(eq(userAuthRoles.userId, userId));
  return rows.map(r => r.id);
}

/** Every person's own access roles, by user id. */
export async function rolesByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!userIds.length) return out;
  const rows = await db.select().from(userAuthRoles).where(inArray(userAuthRoles.userId, userIds));
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.authRoleId]);
  return out;
}

/** Replaces a person's access roles with exactly these (duplicates dropped). */
export async function setUserRoles(userId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  const now = new Date();
  await db.transaction(async tx => {
    await tx.delete(userAuthRoles).where(eq(userAuthRoles.userId, userId));
    for (const authRoleId of unique) {
      await tx.insert(userAuthRoles).values({ id: randomUUID(), userId, authRoleId, createdAt: now });
    }
    // The old single-role column is retired — keep it empty so there's one source.
    await tx.update(users).set({ authRoleId: null }).where(eq(users.id, userId));
  });
}

/** One of someone's access roles: its name and what it grants. */
export interface HeldRole { id: string; name: string; modules: string[]; functions: string[] }

/**
 * Every access role someone holds — their own (UserAuthRole, plus the retired
 * single User.authRoleId) and their staff record's position role. The one
 * place this is worked out: sign-in checks (resolveGrants) and notifications
 * both use it.
 */
export async function rolesHeldBy(userId: string): Promise<HeldRole[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return [];
  const ids = new Set<string>();
  if (user.authRoleId) ids.add(user.authRoleId);
  for (const r of await db.select({ id: userAuthRoles.authRoleId }).from(userAuthRoles).where(eq(userAuthRoles.userId, userId))) ids.add(r.id);
  if (user.teacherId) {
    const [teacher] = await db.select({ positionId: teachers.positionId }).from(teachers).where(eq(teachers.id, user.teacherId));
    if (teacher?.positionId) {
      const [position] = await db.select({ authRoleId: positions.authRoleId }).from(positions).where(eq(positions.positionId, teacher.positionId));
      if (position?.authRoleId) ids.add(position.authRoleId);
    }
  }
  const held: HeldRole[] = [];
  for (const id of ids) {
    const builtIn = builtInRole(id);
    if (builtIn) { held.push({ id, name: builtIn.name, modules: [...builtIn.modules], functions: [...builtIn.functions] }); continue; }
    const [role] = await db.select({ name: authRoles.name }).from(authRoles).where(eq(authRoles.id, id));
    if (!role) continue;
    const mods = await db.select({ module: authRoleModules.module }).from(authRoleModules).where(eq(authRoleModules.authRoleId, id));
    const fns = await db.select({ view: authRoleViews.view }).from(authRoleViews).where(eq(authRoleViews.authRoleId, id));
    held.push({ id, name: role.name, modules: mods.map(m => m.module), functions: fns.map(v => v.view) });
  }
  return held;
}
