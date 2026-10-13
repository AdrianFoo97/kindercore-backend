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
// A User's grants are the union of up to two independent sources:
//   1. User.authRoleId — a direct grant, for admin-portal team members who
//      aren't teaching staff (no career-ladder Position to hang an AuthRole
//      off of).
//   2. User.teacherId -> Teacher.positionId -> Position.authRoleId — for
//      teaching staff, whose access is tied to where they sit on the career
//      ladder.
// Either, both, or neither may be present; results are combined, not one
// overriding the other. Resolved live per request (not embedded in the JWT)
// so an admin can grant/revoke immediately without forcing a re-login — this
// only runs on routes that opt into requireModule/requireView, not every
// request.
export async function resolveGrants(userId: string): Promise<{ modules: Set<string>; views: Set<string> }> {
  const modules = new Set<string>();
  const views = new Set<string>();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { modules, views };

  const authRoleIds = new Set<string>();
  if (user.authRoleId) authRoleIds.add(user.authRoleId);
  if (user.teacherId) {
    const [teacher] = await db.select().from(teachers).where(eq(teachers.id, user.teacherId));
    if (teacher?.positionId) {
      const [position] = await db.select().from(positions).where(eq(positions.positionId, teacher.positionId));
      if (position?.authRoleId) authRoleIds.add(position.authRoleId);
    }
  }

  for (const authRoleId of authRoleIds) {
    const modRows = await db.select({ module: authRoleModules.module }).from(authRoleModules).where(eq(authRoleModules.authRoleId, authRoleId));
    const viewRows = await db.select({ view: authRoleViews.view }).from(authRoleViews).where(eq(authRoleViews.authRoleId, authRoleId));
    for (const r of modRows) modules.add(r.module);
    for (const r of viewRows) views.add(r.view);
  }

  return { modules, views };
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
