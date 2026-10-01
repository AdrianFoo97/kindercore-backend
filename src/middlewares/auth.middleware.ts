import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, teachers, positions, authRoleModules, authRoleViews } from '../db/schema.js';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  teacherId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPERADMIN') {
    res.status(403).json({ message: 'Forbidden: Admin only' });
    return;
  }
  next();
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET!,
    ) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// ── AuthRole resolution ──────────────────────────────────────────────────────
// Resolves req.user.id -> User.teacherId -> Teacher.positionId ->
// Position.authRoleId -> AuthRole -> its granted Modules/Views. Resolved
// live per request (not embedded in the JWT) so an admin can grant/revoke
// a specific View immediately without forcing a re-login — this only runs
// on routes that opt into requireModule/requireView, not every request.
export async function resolveGrants(userId: string): Promise<{ modules: Set<string>; views: Set<string> }> {
  const empty = { modules: new Set<string>(), views: new Set<string>() };
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teacherId) return empty;
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, user.teacherId));
  if (!teacher?.positionId) return empty;
  const [position] = await db.select().from(positions).where(eq(positions.positionId, teacher.positionId));
  if (!position?.authRoleId) return empty;
  const modRows = await db.select({ module: authRoleModules.module }).from(authRoleModules).where(eq(authRoleModules.authRoleId, position.authRoleId));
  const viewRows = await db.select({ view: authRoleViews.view }).from(authRoleViews).where(eq(authRoleViews.authRoleId, position.authRoleId));
  return {
    modules: new Set(modRows.map(r => r.module)),
    views: new Set(viewRows.map(r => r.view)),
  };
}

// Exported (not just used internally by requireModule/requireView) so a
// controller that needs conditional logic rather than a hard gate — e.g.
// listRevisions scoping results to "my own" vs. "everyone's" — can reuse
// the exact same admin-bypass rule instead of redefining it.
export function isAdminRole(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}

// Gates a route behind an AuthRole having the given Module granted.
// ADMIN/SUPERADMIN bypass unconditionally, same as adminMiddleware.
export function requireModule(module: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const grants = await resolveGrants(req.user!.id);
    if (!grants.modules.has(module)) {
      res.status(403).json({ message: 'Forbidden: module not permitted' });
      return;
    }
    next();
  };
}

// Gates a route behind an AuthRole having the given View granted — a
// finer-grained gate than requireModule, for specific actions within a
// module that not every AuthRole sharing that module should get (e.g. the
// Improvement Inbox's approve/reject action within the Operation module).
export function requireView(view: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const grants = await resolveGrants(req.user!.id);
    if (!grants.views.has(view)) {
      res.status(403).json({ message: 'Forbidden: view not permitted' });
      return;
    }
    next();
  };
}
