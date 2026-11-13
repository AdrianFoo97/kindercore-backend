import { describe, it, expect } from 'vitest';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';
import { APPROVED_PUBLIC } from '../securityPolicy.js';

// Every endpoint must require sign-in (authMiddleware) unless it is on this
// list, with a reason. Uses the architecture generated from the route
// files, so a new route added without authMiddleware fails here until
// someone deliberately approves it — the most common way an API leaks.
//
// To approve a new public endpoint: add it below WITH a reason, and make
// sure the handler protects itself (validation, rate limit, one-time use…).

// The approved list lives in ../securityPolicy.ts (shared with the live HTTP sweep).

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
