// Access roles: built-in roles (defined here, can't be edited) + roles an
// admin builds in Settings → Access roles (AuthRole rows). Both grant
// modules (whole areas of the app) and functions (finer actions inside a
// module, checked with requireView/hasView).
//
// Only list a function here once a requireView(...)/hasView(...) check for it
// exists — a role must never promise access the app doesn't enforce. A
// built-in role is added once what makes it different is really checked.
//
// Mirrored for the screens by GET /api/auth-roles (+ /auth-roles/catalog).
import { MODULES, type ModuleKey } from './authModules.js';

export interface AccessFunction { key: string; module: ModuleKey; label: string; description: string }

export const ACCESS_FUNCTIONS: AccessFunction[] = [
  { key: 'OPERATION_SOP_APPROVE', module: MODULES.OPERATION, label: 'Approve How-To Guide changes',
    description: 'Review and decide on How-To Guide changes staff submit.' },
  { key: 'OPERATION_INCIDENT_MANAGE', module: MODULES.OPERATION, label: 'Manage the incident log',
    description: 'See every incident report (not just your own), correct it, change its status and add to the follow-up log.' },
  { key: 'OPERATION_FACILITY_MANAGE', module: MODULES.OPERATION, label: 'Manage facility issues',
    description: 'See every facility issue staff report and mark it In progress or Resolved.' },
  { key: 'OPERATION_PURCHASE_MANAGE', module: MODULES.OPERATION, label: 'Manage the shopping list',
    description: 'See everything staff asked to be bought and tick items Bought (with cost and receipt) or Not buying.' },
  { key: 'HR_SEE_ALL_STAFF', module: MODULES.HR, label: 'Whole-school HR — every staff member',
    description: 'Every staff record, appraisal, observation and points balance — not just the people who report to you — plus recruitment, new staff, onboarding and the reward workbench.' },
  { key: 'ANALYSIS_PROFIT_PUBLISH', module: MODULES.ANALYSIS, label: 'Publish profit sharing',
    description: 'Publish a month’s profit-sharing pool so staff see it on Pay, or take it back with a reason. Staff see no month until it’s published.' },
  { key: 'HR_SEE_PAY', module: MODULES.HR, label: 'See pay & salaries',
    description: 'Salaries, allowances, pay settings and payroll for the staff they can see. Without it, HRMS shows no pay at all.' },
];
export const ACCESS_FUNCTION_KEYS = ACCESS_FUNCTIONS.map(f => f.key);

/** Publishing profit sharing — decided to be the Finance Manager's alone, so the Principal (otherwise every function) doesn't get it. */
export const PROFIT_PUBLISH_FUNCTION = 'ANALYSIS_PROFIT_PUBLISH';

/** What each module opens on its own (before any functions) — shown on every role so it's clear what it allows. Keep in step with the Navbar. */
export const MODULE_INCLUDES: Record<ModuleKey, string[]> = {
  MARKETING: ['Leads — add, update status, book visits, WhatsApp parents, delete and restore', 'Campaigns'],
  STUDENTS: ['Students — records, enrolment, withdraw and reactivate', 'Student onboarding'],
  HR: ['Staff records of their team (everyone below them in the reporting line) — no pay', 'Appraisals, appraisal schedule and practice observations — for their team', 'Career, training and points of their team'],
  FINANCE: ['Operating costs'],
  OPERATION: ['How-To Guides — use them and suggest changes', 'Report incidents and facility issues (their own)', 'Ask for items to be bought', 'Score appraisals they’re asked to do'],
  ANALYSIS: ['Reports — sales & marketing, sales, revenue, staff cost, operating cost, finance, profit sharing, annual bonus'],
  TOOLS: ['WhatsApp and message templates', 'Enquiry and job application forms, form links', 'Operations planner'],
};

export const BUILT_IN_ROLE_PREFIX = 'builtin:';

export interface BuiltInRole {
  id: string;
  /** The area it's listed under on Settings → Access roles. */
  area: string;
  name: string;
  description: string;
  modules: ModuleKey[];
  functions: string[];
}

const ALL_MODULES = Object.values(MODULES) as ModuleKey[];
const role = (key: string, area: string, name: string, description: string, modules: ModuleKey[], functions: string[] = []): BuiltInRole =>
  ({ id: BUILT_IN_ROLE_PREFIX + key, area, name, description, modules, functions });

export const BUILT_IN_ROLES: BuiltInRole[] = [
  role('MARKETING_EXECUTIVE', 'Marketing', 'Marketing Executive',
    'Leads, campaigns and the enquiry pipeline.', [MODULES.MARKETING]),
  role('FRONT_DESK_OFFICER', 'Admissions & Students', 'Front Desk Officer',
    'Students: records, enrolment, onboarding and attendance.', [MODULES.STUDENTS]),
  role('TEAM_LEAD', 'HRMS', 'Team Lead',
    'HRMS for the people under them in the reporting line — their records, appraisals, training and points. No pay.', [MODULES.HR]),
  role('HR_MANAGER', 'HRMS', 'HR Manager',
    'All of HRMS for every staff member — recruitment, staff records, appraisals, points. No pay.', [MODULES.HR], ['HR_SEE_ALL_STAFF']),
  role('HR_DIRECTOR', 'HRMS', 'HR Director',
    'Everything an HR Manager can, plus salaries, allowances, pay settings and payroll.', [MODULES.HR], ['HR_SEE_ALL_STAFF', 'HR_SEE_PAY']),
  role('ACCOUNTS_EXECUTIVE', 'Finance', 'Accounts Executive',
    'Finance: operating costs.', [MODULES.FINANCE]),
  role('FINANCE_MANAGER', 'Finance', 'Finance Manager',
    'Everything an Accounts Executive can, plus the Analysis reports and publishing profit sharing.', [MODULES.FINANCE, MODULES.ANALYSIS], [PROFIT_PUBLISH_FUNCTION]),
  role('TEACHER', 'Operation', 'Teacher',
    'Use guides, suggest improvements, report incidents and facility issues, request items. Their own appraisals, training and pay.', [MODULES.OPERATION]),
  role('SUPERVISOR', 'Operation', 'Supervisor',
    'Everything a Teacher can, plus approving guide changes, the incident log and the shopping list. Scores appraisals for their team.',
    [MODULES.OPERATION], ['OPERATION_SOP_APPROVE', 'OPERATION_INCIDENT_MANAGE', 'OPERATION_PURCHASE_MANAGE']),
  role('OPERATIONS_MANAGER', 'Operation', 'Operations Manager',
    'Everything a Supervisor can, plus facility issues.',
    [MODULES.OPERATION], ['OPERATION_SOP_APPROVE', 'OPERATION_INCIDENT_MANAGE', 'OPERATION_PURCHASE_MANAGE', 'OPERATION_FACILITY_MANAGE']),
  role('PRINCIPAL', 'Management', 'Principal',
    'Every module and every function, for all staff — except publishing profit sharing (the Finance Manager’s).', ALL_MODULES, ACCESS_FUNCTION_KEYS.filter(k => k !== PROFIT_PUBLISH_FUNCTION)),
  role('ANALYST', 'Management', 'Analyst',
    'The Analysis reports only.', [MODULES.ANALYSIS]),
];

export function isBuiltInRoleId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(BUILT_IN_ROLE_PREFIX);
}

export function builtInRole(id: string | null | undefined): BuiltInRole | null {
  return BUILT_IN_ROLES.find(r => r.id === id) ?? null;
}

/** The old seeded roles (by name) and the built-in role that replaces each. */
export const REPLACED_ROLE_NAMES: Record<string, string> = {
  Teacher: BUILT_IN_ROLE_PREFIX + 'TEACHER',
  Supervisor: BUILT_IN_ROLE_PREFIX + 'SUPERVISOR',
  Principal: BUILT_IN_ROLE_PREFIX + 'PRINCIPAL',
};
