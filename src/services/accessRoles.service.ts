import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authRoles, userAuthRoles, users } from '../db/schema.js';
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
