import { describe, it, expect } from 'vitest';
import { requireAppRequest } from '../../middlewares/csrf.middleware.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE, SESSION_COOKIE, cookieValue, sessionToken } from '../../services/session.service.js';

// The session lives in an httpOnly cookie (scripts in the page can't read
// it). Because browsers send cookies automatically, a changing request that
// rides on the cookie must also carry the app's own header — another website
// can't add it, so it can't make a signed-in person's browser change data.

const run = (method: string, headers: Record<string, string>) => {
  let status = 0;
  let passed = false;
  const res = { status: (s: number) => { status = s; return { json: () => undefined }; } };
  requireAppRequest({ method, headers } as never, res as never, () => { passed = true; });
  return { passed, status };
};
const SESSION = `${SESSION_COOKIE}=abc.def.ghi`;

describe('Security — session cookie and cross-site requests', () => {
  it('refuses a changing request that rides on the session cookie without the app\'s own header', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(run(method, { cookie: SESSION }), method).toEqual({ passed: false, status: 403 });
      expect(run(method, { cookie: SESSION, [APP_REQUEST_HEADER]: 'XMLHttpRequest' }).passed).toBe(false);
    }
  });

  it('lets the app\'s own requests through, and never blocks reading', () => {
    expect(run('POST', { cookie: SESSION, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE }).passed).toBe(true);
    expect(run('GET', { cookie: SESSION }).passed).toBe(true);
  });

  it('leaves requests without the session cookie alone — public forms, the door reader, scripts', () => {
    expect(run('POST', {}).passed).toBe(true);
    expect(run('POST', { 'x-reader-key': 'k' }).passed).toBe(true);
    expect(run('POST', { authorization: 'Bearer t' }).passed).toBe(true);
  });

  it('reads the session from the cookie first, else a Bearer header', () => {
    expect(cookieValue(`a=1; ${SESSION_COOKIE}=tok%2E1; b=2`, SESSION_COOKIE)).toBe('tok.1');
    expect(cookieValue('a=1', SESSION_COOKIE)).toBeNull();
    expect(sessionToken({ headers: { cookie: SESSION, authorization: 'Bearer other' } } as never)).toEqual({ token: 'abc.def.ghi', via: 'cookie' });
    expect(sessionToken({ headers: { authorization: 'Bearer t' } } as never)).toEqual({ token: 't', via: 'header' });
    expect(sessionToken({ headers: {} } as never)).toBeNull();
  });
});
