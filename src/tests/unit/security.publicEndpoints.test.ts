import { describe, it, expect } from 'vitest';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';

// Every endpoint must require sign-in (authMiddleware) unless it is on this
// list, with a reason. Uses the architecture generated from the route
// files, so a new route added without authMiddleware fails here until
// someone deliberately approves it — the most common way an API leaks.
//
// To approve a new public endpoint: add it below WITH a reason, and make
// sure the handler protects itself (validation, rate limit, one-time use…).

const APPROVED_PUBLIC: Record<string, string> = {
  'POST /api/auth/login': 'The login form — you are not signed in yet. Rate-limited in server.ts.',
  'GET /api/auth/invite/:token': 'Invite link check before an account exists; the long random token is the credential.',
  'POST /api/auth/activate': 'Sets a password from an invite; needs the one-time, expiring invite token.',
  'POST /api/leads': 'Public enquiry form on the website. Honeypot-protected.',
  'GET /api/marketing-campaigns/check': 'Enquiry form checks a promo code is valid.',
  'POST /api/candidates': 'Public job application form.',
  'GET /api/candidates/form-options': 'Job application form loads its dropdown options.',
  'POST /api/candidates/:id/resume': 'Applicant attaches a resume right after applying; one upload only, within a short window.',
  'GET /api/google/auth': 'Starts Google Calendar connection; the redirect carries a signed state token.',
  'GET /api/google/callback': 'Google redirects back here; verified by the signed state token.',
  // No user login, but guarded by readerOrStaffMiddleware: the reader's
  // X-Reader-Key or a signed-in staff member. Only enforced once
  // ATTENDANCE_READER_KEY is set on the server (see reader.middleware.ts).
  'POST /api/attendance/scan': 'Physical RFID readers at the door have no user login — they use a reader key instead.',
};

const endpoints = ARCHITECTURE.routeGroups.flatMap(g => g.endpoints);
const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
const isPublic = (e: { middleware: string[] }) => !e.middleware.includes('authMiddleware');

describe('Security — no endpoint is accidentally public', () => {
  it('every endpoint without a sign-in check is on the approved list', () => {
    const unapproved = endpoints.filter(isPublic).map(key).filter(k => !(k in APPROVED_PUBLIC));
    expect(unapproved, 'Add authMiddleware, or approve with a reason in APPROVED_PUBLIC').toEqual([]);
  });

  it('the approved list has nothing stale — each entry is still a real public endpoint', () => {
    const actualPublic = new Set(endpoints.filter(isPublic).map(key));
    const stale = Object.keys(APPROVED_PUBLIC).filter(k => !actualPublic.has(k));
    expect(stale, 'Remove these from APPROVED_PUBLIC — they now require sign-in or no longer exist').toEqual([]);
  });

  it('every admin-only endpoint also checks sign-in first', () => {
    // adminMiddleware reads the user that authMiddleware sets — on its own it
    // would refuse everyone, but the order must still be sign-in → admin.
    const bad = endpoints.filter(e => e.middleware.includes('adminMiddleware'))
      .filter(e => {
        const auth = e.middleware.indexOf('authMiddleware');
        return auth === -1 || auth > e.middleware.indexOf('adminMiddleware');
      }).map(key);
    expect(bad).toEqual([]);
  });

  it('every module/view-restricted endpoint also checks sign-in first', () => {
    const bad = endpoints.filter(e => e.middleware.some(m => /^require(Module|View)\(/.test(m)))
      .filter(e => {
        const auth = e.middleware.indexOf('authMiddleware');
        const gate = e.middleware.findIndex(m => /^require(Module|View)\(/.test(m));
        return auth === -1 || auth > gate;
      }).map(key);
    expect(bad).toEqual([]);
  });

  it('destructive admin tools (reset / seed) are admin-only', () => {
    const risky = endpoints.filter(e => /\/(reset|reset-all|seed[\w-]*)$/.test(e.path));
    expect(risky.length).toBeGreaterThan(0);
    const open = risky.filter(e => !e.middleware.includes('adminMiddleware') && !e.middleware.includes('superadminMiddleware')).map(key);
    expect(open).toEqual([]);
  });
});
