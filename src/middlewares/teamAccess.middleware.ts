import type { Request, Response, NextFunction } from 'express';
import { MODULES } from '../constants/authModules.js';
import { isAdminRole, isOwnTeacher, resolveGrants } from './auth.middleware.js';
import { OUTSIDE_TEAM, SEE_ALL_STAFF_VIEW, SEE_PAY_VIEW, inStaffScope, staffScopeFor } from '../services/performanceScope.service.js';

// HRMS access to one staff member's record (/teachers/:teacherId/…), by
// reporting line and by pay:
//  • the HR module alone = the people below you in the reporting line, no pay
//    (a Team Lead);
//  • "Whole-school HR" (HR_SEE_ALL_STAFF) = every staff member, plus the
//    school-wide HR desks (recruitment, new staff, onboarding, rewards);
//  • "See pay & salaries" (HR_SEE_PAY) = pay, for whoever you can see.
// Admins pass everything; a teacher always reaches their own record.
// Assigned per access role in Settings — never by job title.

const NO_PAY = 'Pay isn’t part of your access.';

type Rule = { self: boolean; pay: boolean };

function teamRule({ self, pay }: Rule, param: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role) || (self && isOwnTeacher(req, param))) { next(); return; }
    const grants = await resolveGrants(req.user!.id);
    if (!grants.modules.has(MODULES.HR)) { res.status(403).json({ message: 'Forbidden: not your record' }); return; }
    if (pay && !grants.views.has(SEE_PAY_VIEW)) { res.status(403).json({ message: NO_PAY }); return; }
    const scope = await staffScopeFor({ id: req.user!.id, role: req.user!.role, teacherId: req.user!.teacherId ?? null });
    if (!inStaffScope(scope, req.params[param])) { res.status(403).json({ message: OUTSIDE_TEAM }); return; }
    next();
  };
}

/** Read a staff member's record: themselves, or HR for someone in their team (everyone with Whole-school HR). */
export const selfOrTeam = (param = 'teacherId') => teamRule({ self: true, pay: false }, param);
/** Change a staff member's record: HR for someone in their team (not the person themselves). */
export const teamMember = (param = 'teacherId') => teamRule({ self: false, pay: false }, param);
/** Read someone's pay: themselves, or HR with "See pay & salaries" for someone in their team. */
export const selfOrTeamPay = (param = 'teacherId') => teamRule({ self: true, pay: true }, param);
/** Change someone's pay: HR with "See pay & salaries", for someone in their team. */
export const teamPay = (param = 'teacherId') => teamRule({ self: false, pay: true }, param);

/**
 * School-wide pay figures (payroll, staff cost): Finance and Analysis read
 * them for their reports; in HR only those with "See pay & salaries".
 */
export function payrollAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const { modules, views } = await resolveGrants(req.user!.id);
    if (modules.has(MODULES.FINANCE) || modules.has(MODULES.ANALYSIS) || (modules.has(MODULES.HR) && views.has(SEE_PAY_VIEW))) { next(); return; }
    res.status(403).json({ message: NO_PAY });
  };
}

/** The school-wide HR desks (recruitment, new staff, onboarding, the reward workbench): HR with Whole-school HR. */
export function wholeSchoolHr() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const { modules, views } = await resolveGrants(req.user!.id);
    if (modules.has(MODULES.HR) && views.has(SEE_ALL_STAFF_VIEW)) { next(); return; }
    res.status(403).json({ message: 'That’s for whole-school HR.' });
  };
}

/** School-wide pay set-up (positions and their salaries, level incentives, allowance types): HR with "See pay & salaries". */
export function hrWithPay() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAdminRole(req.user?.role)) { next(); return; }
    const { modules, views } = await resolveGrants(req.user!.id);
    if (modules.has(MODULES.HR) && views.has(SEE_PAY_VIEW)) { next(); return; }
    res.status(403).json({ message: NO_PAY });
  };
}
