import { describe, it, expect } from 'vitest';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';
import { APPROVED_ANY_SIGNED_IN } from '../securityPolicy.js';

// Every endpoint that requires sign-in must ALSO say who among signed-in
// users may use it — admin, a module (HR, Finance…), a view, or "this
// teacher's own record" — unless it's on this list with a reason. Before
// this, 183 endpoints let any signed-in account through (any teacher could
// grant themselves points, change allowances, read resumes, invite admins).
//
// To add a new endpoint for every signed-in user: list it here WITH the
// reason, and make sure it's read-only reference data or scoped to the
// caller inside the handler.

// The approved list lives in ../securityPolicy.ts (shared with the live HTTP sweep).

// …plus the HRMS team / pay rules (teamAccess.middleware).
const GATES = /^(adminMiddleware|superadminMiddleware|requireModule\(|requireAnyModule\(|requireView\(|selfOrModule\(|selfOrTeam\(|teamMember\(|selfOrTeamPay\(|teamPay\(|payrollAccess\(|wholeSchoolHr\(|hrWithPay\(|settingKeyOwner\()/;
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

  it('nothing open to every signed-in user can change data, except filing a bug report, an incident report, a facility issue, a purchase request (or editing your own), a guide proposal (or resending your own) and its step photos, or choosing and reading your own notifications', () => {
    const writes = signedInOnly.filter(e => e.method !== 'GET').map(key).sort();
    expect(writes).toEqual([
      'DELETE /api/purchase-requests/:id', 'PATCH /api/purchase-requests/:id',
      'POST /api/bug-reports', 'POST /api/facility-issues', 'POST /api/incidents',
      'POST /api/notifications/:id/read', 'POST /api/notifications/read-all', 'POST /api/purchase-requests',
      'POST /api/purchase-requests/:id/bought-myself', 'POST /api/sop-revisions', 'POST /api/sop-revisions/:id/resubmit', 'POST /api/sop-steps/images', 'POST /api/upload/bug-report-photos',
      'PUT /api/notifications/settings',
    ]);
  });

  it('only shopping-list managers can see the shopping list, approve it, tick items off or see receipts', () => {
    for (const [m, p] of [
      ['POST', '/api/purchase-requests/approve-all'], ['POST', '/api/purchase-requests/:id/approve'],
      ['GET', '/api/purchase-requests/shopping-list'], ['POST', '/api/purchase-requests/:id/bought'],
      ['POST', '/api/purchase-requests/:id/not-buying'], ['POST', '/api/purchase-requests/:id/back-to-list'],
      ['GET', '/api/purchase-requests/:id/receipt'], ['PUT', '/api/purchase-requests/:id/note'],
    ] as const) {
      expect(gateOf(m, p)?.[0], `${m} ${p}`).toBe("requireView('OPERATION_PURCHASE_MANAGE')");
    }
  });

  it('only facility managers can see every facility issue or change its status', () => {
    expect(gateOf('GET', '/api/facility-issues')).toEqual(["requireView('OPERATION_FACILITY_MANAGE')"]);
    expect(gateOf('PATCH', '/api/facility-issues/:id/status')).toEqual(["requireView('OPERATION_FACILITY_MANAGE')"]);
  });

  it('only incident managers can see every incident report or follow one up', () => {
    expect(gateOf('GET', '/api/incidents')).toEqual(["requireView('OPERATION_INCIDENT_MANAGE')"]);
    expect(gateOf('PATCH', '/api/incidents/:id')).toEqual(["requireView('OPERATION_INCIDENT_MANAGE')"]);
    expect(gateOf('POST', '/api/incidents/:id/log')).toEqual(["requireView('OPERATION_INCIDENT_MANAGE')"]);
  });

  // The access gate(s) only — not sign-in, and not the access-log recorder.
  const gateOf = (method: string, path: string) =>
    endpoints.find(e => e.method === method && e.path === path)?.middleware
      .filter(m => m !== 'authMiddleware' && !m.startsWith('logSensitiveAccess(')) ?? null;

  it('every read of pay, finance, appraisal or applicant records is written to the access log', () => {
    const logged: [string, string, string][] = [
      ['GET', '/api/finance/summary', 'FINANCE'],
      ['POST', '/api/operating-cost/import/read', 'FINANCE'], ['GET', '/api/operating-cost/import/notices', 'FINANCE'], ['GET', '/api/operating-cost/import/history', 'FINANCE'],
      ['GET', '/api/salary/teachers', 'PAYROLL'], ['GET', '/api/salary/payroll-by-month', 'PAYROLL'],
      ['GET', '/api/salary/teacher-weights-by-month', 'PAYROLL'], ['GET', '/api/salary/employer-contributions', 'PAYROLL'],
      ['GET', '/api/teachers/:teacherId/allowances', 'STAFF_PAY'], ['GET', '/api/teachers/:teacherId/pay-pools', 'STAFF_PAY'], ['GET', '/api/salary/teachers/:teacherId', 'STAFF_PAY'],
      ['GET', '/api/teachers/:teacherId/appraisals', 'APPRAISALS'], ['GET', '/api/appraisals/overview', 'APPRAISALS'],
      ['GET', '/api/appraisal-schedules', 'APPRAISALS'], ['GET', '/api/appraisal-schedules/created', 'APPRAISALS'], ['GET', '/api/appraisal-runs/tasks', 'APPRAISALS'], ['GET', '/api/appraisal-runs/:id', 'APPRAISALS'],
      ['GET', '/api/candidates/:id/resume', 'APPLICANTS'],
    ];
    for (const [m, p, area] of logged) {
      const mw = endpoints.find(e => e.method === m && e.path === p)?.middleware ?? [];
      expect(mw, `${m} ${p}`).toContain(`logSensitiveAccess('${area}')`);
      // Recorded only after the gate has let the request through.
      expect(mw.indexOf(`logSensitiveAccess('${area}')`), `${m} ${p}`).toBe(mw.length - 1);
    }
  });

  it('only Admins can invite users, see the user list or delete users', () => {
    expect(gateOf('POST', '/api/auth/invite')).toEqual(['adminMiddleware']);
    expect(gateOf('GET', '/api/auth/users')).toEqual(['adminMiddleware']);
    expect(gateOf('DELETE', '/api/auth/users/:id')).toEqual(['adminMiddleware']);
  });

  it('pay data is limited to HR with “See pay & salaries” (for their team), Finance / Analysis, or the teacher\'s own record', () => {
    expect(gateOf('GET', '/api/salary/teachers')).toEqual(['payrollAccess()']);
    expect(gateOf('GET', '/api/salary/payroll-by-month')).toEqual(['payrollAccess()']);
    expect(gateOf('GET', '/api/salary/teachers/:teacherId')).toEqual(['selfOrTeamPay()']);
    expect(gateOf('GET', '/api/teachers/:teacherId/allowances')).toEqual(['selfOrTeamPay()']);
    expect(gateOf('PUT', '/api/teachers/:teacherId/allowances')).toEqual(['teamPay()']);
  });

  it('the school\'s finance figures are Finance / Analysis only; a teacher gets just their own pool figures', () => {
    expect(gateOf('GET', '/api/finance/summary')).toEqual(['requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS)']);
    expect(gateOf('GET', '/api/salary/teacher-weights-by-month')).toEqual(['payrollAccess()']);
    expect(gateOf('GET', '/api/teachers/:teacherId/pay-pools')).toEqual(['selfOrTeamPay()']);
  });

  it('HR grants points to their team, only whole-school HR edits the ledger; a teacher\'s own points are theirs or their team HR\'s', () => {
    expect(gateOf('POST', '/api/teachers/:teacherId/points/grant')).toEqual(['teamMember()']);
    expect(gateOf('PATCH', '/api/transactions/:id')).toEqual(['wholeSchoolHr()']);
    expect(gateOf('GET', '/api/teachers/:teacherId/points')).toEqual(['selfOrTeam()']);
    expect(gateOf('POST', '/api/teachers/:teacherId/rewards/redeem')).toEqual(['selfOrTeam()']);
  });

  it('job applicants\' details and resumes are for whole-school HR only', () => {
    expect(gateOf('GET', '/api/candidates')).toEqual(['wholeSchoolHr()']);
    expect(gateOf('GET', '/api/candidates/:id/resume')).toEqual(['wholeSchoolHr()']);
  });

  it('settings-type templates are changed only by the area whose Settings page they’re on (reward catalog and missions → HR Manager and above, positions → HR with pay, cost categories → Finance)', () => {
    for (const [m, p, gate] of [
      ['POST', '/api/points/rewards', 'wholeSchoolHr()'], ['PATCH', '/api/points/rules/:id', 'wholeSchoolHr()'],
      ['PUT', '/api/salary/positions/:positionId', 'hrWithPay()'], ['POST', '/api/allowance-types', 'hrWithPay()'],
      ['POST', '/api/operating-cost/categories', 'requireModule(MODULES.FINANCE)'], ['DELETE', '/api/career-missions/:id', 'wholeSchoolHr()'],
      ['POST', '/api/appraisal-templates', 'wholeSchoolHr()'], ['PUT', '/api/packages/programmes', 'requireModule(MODULES.MARKETING)'],
      ['PATCH', '/api/settings/:key', 'settingKeyOwner()'],
    ] as const) {
      expect(gateOf(m, p), `${m} ${p}`).toEqual([gate]);
    }
  });

  it('the company, integrations, AI, departments and team & access stay Admin-only', () => {
    for (const [m, p] of [
      ['PUT', '/api/ai/settings'], ['PATCH', '/api/google/calendar'], ['PUT', '/api/salary/departments/:departmentId'],
      ['POST', '/api/auth/invite'], ['PUT', '/api/auth/users/:id/auth-roles'], ['POST', '/api/auth-roles'],
    ] as const) {
      expect(gateOf(m, p), `${m} ${p}`).toEqual(['adminMiddleware']);
    }
  });
});
