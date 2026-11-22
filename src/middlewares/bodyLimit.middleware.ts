import express, { type NextFunction, type Request, type Response } from 'express';

// How much JSON a request may carry. Everything is small except the admin
// candidate import (up to 500 rows ≈ a few MB). Reading a big body costs the
// server time and memory, so the big allowance is given only on that route,
// AFTER sign-in and the admin check — someone not signed in can never make
// the server read more than SMALL_JSON_LIMIT.

export const SMALL_JSON_LIMIT = '1mb';
export const LARGE_JSON_LIMIT = '10mb';
/** The only route allowed a large body (read in its route, after the access checks). */
export const LARGE_BODY_PATHS = ['/api/candidates/import'];

const small = express.json({ limit: SMALL_JSON_LIMIT });

/** App-wide JSON parsing at the small limit (large-body routes parse their own, later). */
export function smallJsonBody(req: Request, res: Response, next: NextFunction): void {
  if (LARGE_BODY_PATHS.includes(req.path)) { next(); return; }
  small(req, res, next);
}

/** The large allowance — put it after authMiddleware and the access check on a LARGE_BODY_PATHS route. */
export const largeJsonBody = express.json({ limit: LARGE_JSON_LIMIT });
