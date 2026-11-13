import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// The signed-in session lives in an httpOnly cookie, not in the page's
// localStorage — so a script injected into the page (XSS) can't read and
// steal it. The site (kindertech-cloud.com) and the API
// (api.kindertech-cloud.com) are the same "site", so a SameSite=Lax cookie
// set by the API is sent on the app's requests and never on another site's.
//
// Because a cookie is sent automatically, changing requests must also carry
// APP_REQUEST_HEADER (see csrf.middleware.ts): another website can't add a
// custom header to a request without CORS allowing its origin, which it doesn't.

export const SESSION_COOKIE = 'kc_session';
export const SESSION_HOURS = 8;
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

export const APP_REQUEST_HEADER = 'x-requested-with';
export const APP_REQUEST_VALUE = 'KinderCore';

export interface SessionClaims { id: string; email: string; role: string; teacherId: string | null }

/** Secure (HTTPS-only) cookies wherever the app is served over HTTPS — everywhere but local development. */
export const cookieSecure = () => (process.env.FRONTEND_URL ?? '').startsWith('https://');

const cookieOptions = () => ({ httpOnly: true, secure: cookieSecure(), sameSite: 'lax' as const, path: '/' });

/** Sign the person in on this browser. */
export function issueSession(res: Response, claims: SessionClaims): void {
  const token = jwt.sign(claims, process.env.JWT_SECRET!, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
}

/** Sign out on this browser. */
export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** One cookie's value from the raw Cookie header (no cookie-parser needed for one name). */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/**
 * The session token on this request: the cookie (the app), or a
 * "Bearer …" header (scripts and tests). Says which, because only cookie
 * sessions need the cross-site request check.
 */
export function sessionToken(req: Request): { token: string; via: 'cookie' | 'header' } | null {
  const fromCookie = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (fromCookie) return { token: fromCookie, via: 'cookie' };
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7), via: 'header' };
  return null;
}
