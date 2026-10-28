import type { Request, Response } from 'express';

// Minimal Express req/res for calling a controller directly. The handler
// and the database are real; only the HTTP plumbing around them is not.

export function req(body: unknown = {}, params: Record<string, string> = {}): Request {
  return { body, params } as unknown as Request;
}

export interface CapturedResponse {
  statusCode: number;
  body: any;
}

/** A Response that records status + JSON; read `.statusCode` / `.body` after awaiting the handler. */
export function res(): Response & CapturedResponse {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (code: number) => { r.statusCode = code; return r; };
  r.json = (payload: unknown) => { r.body = payload; return r; };
  return r;
}
