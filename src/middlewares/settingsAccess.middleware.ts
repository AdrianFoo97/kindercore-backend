import type { Request, Response, NextFunction } from 'express';
import { isAdminRole, resolveGrants } from './auth.middleware.js';
import { meetsAny, settingKeyAccess } from '../constants/settingKeyAccess.js';

/**
 * PATCH /api/settings/:key — the people whose Settings page the key is on
 * (constants/settingKeyAccess.ts), or an Admin. Unlisted keys: Admin only.
 */
export function settingKeyOwner() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const needs = settingKeyAccess(req.params.key);
    if (needs && meetsAny(needs, await resolveGrants(req.user!.id))) { next(); return; }
    res.status(403).json({ message: 'That setting isn’t part of your access.' });
  };
}
