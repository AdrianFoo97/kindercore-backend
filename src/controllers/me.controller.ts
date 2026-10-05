import { Request, Response } from 'express';
import { resolveGrants } from '../middlewares/auth.middleware.js';
import { ALL_MODULE_KEYS } from '../constants/authModules.js';
import { db } from '../db/client.js';
import { authViews } from '../db/schema.js';

// The one call the frontend needs to know what it can show — the
// frontend never re-derives grants from raw AuthRole data itself.
// ADMIN/SUPERADMIN short-circuit to everything, same bypass as
// requireModule/requireView. `views` for an admin isn't actually load-
// bearing (the frontend's hasView already short-circuits on isAdmin), but
// populated from the live catalog anyway for consistency/debugging.
export async function getMyPermissions(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPERADMIN';
  if (isAdmin) {
    const allViews = await db.select({ key: authViews.key }).from(authViews);
    res.json({ isAdmin: true, modules: ALL_MODULE_KEYS, views: allViews.map(v => v.key) });
    return;
  }
  const grants = await resolveGrants(req.user!.id);
  res.json({ isAdmin: false, modules: [...grants.modules], views: [...grants.views] });
}
