import { db } from '../db/client.js';
import { teachers } from '../db/schema.js';
import { isAdminRole, resolveGrants } from '../middlewares/auth.middleware.js';
import { teamOf } from './appraisalScoring.service.js';

// HRMS (staff records, Performance Management, career, training, points):
// whose records someone may see and act on. Admins, and anyone
// whose access role has the "See every staff member" view, see everyone;
// everyone else sees only their team — the staff who report to them, directly
// or further down. Assigned per access role in Settings, never by job title.

/** Access-role function: every staff member in HRMS, not just your team. */
export const SEE_ALL_STAFF_VIEW = 'HR_SEE_ALL_STAFF';
/** Access-role function: see pay & salaries (for the staff you can see). */
export const SEE_PAY_VIEW = 'HR_SEE_PAY';
export const OUTSIDE_TEAM = 'That’s only for staff in your team.';

/** all = everyone; otherwise just teacherIds (their team). */
export interface StaffScope { all: boolean; teacherIds: Set<string> }
export const ALL_STAFF: StaffScope = { all: true, teacherIds: new Set() };

export const inStaffScope = (scope: StaffScope, teacherId: string): boolean => scope.all || scope.teacherIds.has(teacherId);

/** The staff this user may see in Performance Management. */
export async function staffScopeFor(user: { id: string; role: string; teacherId?: string | null }): Promise<StaffScope> {
  if (isAdminRole(user.role) || (await resolveGrants(user.id)).views.has(SEE_ALL_STAFF_VIEW)) return ALL_STAFF;
  if (!user.teacherId) return { all: false, teacherIds: new Set() };
  const rows = await db.select({ id: teachers.id, reportsTo: teachers.reportsToTeacherId }).from(teachers);
  return { all: false, teacherIds: teamOf(user.teacherId, new Map(rows.map(r => [r.id, r.reportsTo ?? null]))) };
}

/** Whether this user sees pay: admins, or an access role with "See pay & salaries". */
export async function seesPay(user: { id: string; role: string }): Promise<boolean> {
  return isAdminRole(user.role) || (await resolveGrants(user.id)).views.has(SEE_PAY_VIEW);
}
