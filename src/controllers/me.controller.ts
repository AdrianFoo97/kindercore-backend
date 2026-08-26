import { Request, Response } from 'express';
import { resolveGrants } from '../middlewares/auth.middleware.js';
import { ALL_MODULE_KEYS, ALL_VIEW_KEYS } from '../constants/authModules.js';

// The one call the frontend needs to know what it can show — the
// frontend never re-derives grants from raw AuthRole data itself.
// ADMIN/SUPERADMIN short-circuit to everything, same bypass as
// requireModule/requireView.
export async function getMyPermissions(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPERADMIN';
  if (isAdmin) {
    res.json({ isAdmin: true, modules: ALL_MODULE_KEYS, views: ALL_VIEW_KEYS });
    return;
  }
  const grants = await resolveGrants(req.user!.id);
  res.json({ isAdmin: false, modules: [...grants.modules], views: [...grants.views] });
}
