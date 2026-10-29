import { describe, it, expect } from 'vitest';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';

// Every endpoint that requires sign-in must ALSO say who among signed-in
// users may use it — admin, a module (HR, Finance…), a view, or "this
// teacher's own record" — unless it's on this list with a reason. Before
// this, 183 endpoints let any signed-in account through (any teacher could
// grant themselves points, change allowances, read resumes, invite admins).
//
// To add a new endpoint for every signed-in user: list it here WITH the
// reason, and make sure it's read-only reference data or scoped to the
// caller inside the handler.

const APPROVED_ANY_SIGNED_IN: Record<string, string> = {
  'GET /api/me/permissions': 'Your own permissions — scoped to the caller.',
  'GET /api/settings': 'App-wide settings the whole app reads; secret.* settings are filtered out.',
  'GET /api/packages': 'Fee package catalog (reference data).',
  'GET /api/packages/years': 'Package years (reference data).',
  'GET /api/packages/config': 'Package configuration (reference data).',
  'GET /api/allowance-types': 'Allowance type names (reference data, no per-person amounts).',
  'GET /api/auth-roles': 'Access role names for pickers (no permissions are granted by reading them).',
  'POST /api/bug-reports': 'Anyone signed in can report a bug.',
  'GET /api/career-missions': 'Mission catalog the teacher career page lists.',
  'GET /api/mission-categories': 'Mission categories for the teacher career badges.',
  'GET /api/points/rules': 'Earning-rule catalog shown on the teacher "Earn points" page.',
  'GET /api/points/rewards': 'Reward catalog teachers redeem from.',
  'GET /api/redemptions/:id': 'One redemption — the handler only returns it to its owner, HR or Admin.',
  'GET /api/planner/teachers': 'Staff list — the handler returns colleagues as name/colour only unless the caller has HR/Tools/Finance/Analysis.',
  'GET /api/salary/departments': 'Department names (reference data).',
  'GET /api/salary/positions': 'Position salary bands — the same bands the public job application form shows.',
  'GET /api/salary/level-incentives': 'Level incentive table (reference data, not per person).',
  'GET /api/salary/teacher-weights-by-month': 'Profit-share weights — teachers need the team total to see their own pool share; contains no salary amounts.',
  'GET /api/finance/summary': 'Company totals behind the profit-share pools teachers see on their Pay pages (by design).',
  'GET /api/sop-templates': 'How-to guide library every staff member reads.',
  'GET /api/sop-steps': 'Steps of the how-to guides.',
  'GET /api/sop-sections': 'Guide section names.',
  'GET /api/sop-categories': 'Guide category labels.',
  'GET /api/sop-revisions': 'Guide improvement proposals — the handler shows non-reviewers only their own.',
  'GET /api/sop-revisions/:id': 'One proposal — scoped in the handler like the list.',
  'POST /api/sop-revisions': 'Any staff member can propose an improvement to a guide.',
  'POST /api/upload/bug-report-photos': 'Screenshots attached to a bug report (anyone signed in can report a bug).',
};

const GATES = /^(adminMiddleware|superadminMiddleware|requireModule\(|requireAnyModule\(|requireView\(|selfOrModule\()/;
const endpoints = ARCHITECTURE.routeGroups.flatMap(g => g.endpoints);
const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
const signedInOnly = endpoints.filter(e => e.middleware.includes('authMiddleware') && !e.middleware.some(m => GATES.test(m)));

describe('Security — every sensitive area is limited to the right role', () => {
  it('every signed-in endpoint has a role/module/ownership rule, or an approved reason not to', () => {
    const unapproved = signedInOnly.map(key).filter(k => !(k in APPROVED_ANY_SIGNED_IN));
    expect(unapproved, 'Add a role/module gate, or approve with a reason in APPROVED_ANY_SIGNED_IN').toEqual([]);
  });

  it('the approved list has nothing stale', () => {
    const actual = new Set(signedInOnly.map(key));
    expect(Object.keys(APPROVED_ANY_SIGNED_IN).filter(k => !actual.has(k))).toEqual([]);
  });

  it('nothing open to every signed-in user can change data, except filing a bug report or a guide proposal', () => {
    const writes = signedInOnly.filter(e => e.method !== 'GET').map(key).sort();
    expect(writes).toEqual(['POST /api/bug-reports', 'POST /api/sop-revisions', 'POST /api/upload/bug-report-photos']);
  });

  const gateOf = (method: string, path: string) =>
    endpoints.find(e => e.method === method && e.path === path)?.middleware.filter(m => m !== 'authMiddleware') ?? null;

  it('only Admins can invite users, see the user list or delete users', () => {
    expect(gateOf('POST', '/api/auth/invite')).toEqual(['adminMiddleware']);
    expect(gateOf('GET', '/api/auth/users')).toEqual(['adminMiddleware']);
    expect(gateOf('DELETE', '/api/auth/users/:id')).toEqual(['adminMiddleware']);
  });

  it('pay data is limited to HR / Finance / Analysis, or the teacher\'s own record', () => {
    expect(gateOf('GET', '/api/salary/teachers')).toEqual(['requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS)']);
    expect(gateOf('GET', '/api/salary/payroll-by-month')).toEqual(['requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS)']);
    expect(gateOf('GET', '/api/teachers/:teacherId/allowances')).toEqual(['selfOrModule(MODULES.HR)']);
    expect(gateOf('PUT', '/api/teachers/:teacherId/allowances')).toEqual(['requireModule(MODULES.HR)']);
  });

  it('granting and editing points is HR-only; a teacher\'s own points are theirs or HR\'s', () => {
    expect(gateOf('POST', '/api/teachers/:teacherId/points/grant')).toEqual(['requireModule(MODULES.HR)']);
    expect(gateOf('PATCH', '/api/transactions/:id')).toEqual(['requireModule(MODULES.HR)']);
    expect(gateOf('GET', '/api/teachers/:teacherId/points')).toEqual(['selfOrModule(MODULES.HR)']);
    expect(gateOf('POST', '/api/teachers/:teacherId/rewards/redeem')).toEqual(['selfOrModule(MODULES.HR)']);
  });

  it('job applicants\' details and resumes are HR-only', () => {
    expect(gateOf('GET', '/api/candidates')).toEqual(['requireModule(MODULES.HR)']);
    expect(gateOf('GET', '/api/candidates/:id/resume')).toEqual(['requireModule(MODULES.HR)']);
  });

  it('settings-type templates (reward catalog, rules, positions, cost categories) are Admin-only to change', () => {
    for (const [m, p] of [
      ['POST', '/api/points/rewards'], ['PATCH', '/api/points/rules/:id'], ['PUT', '/api/salary/positions/:positionId'],
      ['POST', '/api/operating-cost/categories'], ['DELETE', '/api/career-missions/:id'], ['POST', '/api/allowance-types'],
    ] as const) {
      expect(gateOf(m, p), `${m} ${p}`).toEqual(['adminMiddleware']);
    }
  });
});
