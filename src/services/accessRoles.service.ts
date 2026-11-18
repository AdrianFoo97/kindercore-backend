import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authRoles } from '../db/schema.js';
import { isBuiltInRoleId, builtInRole } from '../constants/accessRoles.js';

/** Why this access role can't be given — or null when it can (null/empty = no role). */
export async function accessRoleProblem(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  if (isBuiltInRoleId(id)) return builtInRole(id) ? null : 'That access role doesn’t exist.';
  const [row] = await db.select({ id: authRoles.id }).from(authRoles).where(eq(authRoles.id, id));
  return row ? null : 'That access role doesn’t exist.';
}
