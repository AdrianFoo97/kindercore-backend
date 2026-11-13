import type { Request, Response } from 'express';

// Minimal Express req/res for calling a controller directly. The handler
// and the database are real; only the HTTP plumbing around them is not.

export function req(body: unknown = {}, params: Record<string, string> = {}): Request {
  return { body, params, headers: {} } as unknown as Request;
}

/** A request with headers and/or an already-authenticated user (as authMiddleware would set). */
export function reqWith(opts: {
  body?: unknown; params?: Record<string, string>; headers?: Record<string, string>;
  user?: { id: string; email: string; role: string; teacherId?: string | null };
}): Request {
  return { body: opts.body ?? {}, params: opts.params ?? {}, headers: opts.headers ?? {}, user: opts.user } as unknown as Request;
}

/** A `next` that records whether the middleware let the request through. */
export function nextSpy(): (() => void) & { called: boolean } {
  const fn = (() => { fn.called = true; }) as (() => void) & { called: boolean };
  fn.called = false;
  return fn;
}

export interface CapturedCookie { value: string; options: Record<string, unknown>; cleared?: boolean }

export interface CapturedResponse {
  statusCode: number;
  body: any;
  /** Cookies the handler set or cleared, by name. */
  cookies: Record<string, CapturedCookie>;
}

/** A Response that records status, JSON and cookies; read `.statusCode` / `.body` / `.cookies` after awaiting the handler. */
export function res(): Response & CapturedResponse {
  const r: any = { statusCode: 200, body: undefined, cookies: {} };
  r.status = (code: number) => { r.statusCode = code; return r; };
  r.json = (payload: unknown) => { r.body = payload; return r; };
  r.end = () => r;
  r.cookie = (name: string, value: string, options: Record<string, unknown> = {}) => { r.cookies[name] = { value, options }; return r; };
  r.clearCookie = (name: string, options: Record<string, unknown> = {}) => { r.cookies[name] = { value: '', options, cleared: true }; return r; };
  return r;
}
