import type { NextFunction, Request, Response } from 'express';

/** API responses are never stored by the browser or a proxy (handlers may override for their own files). */
export function noStoreApi(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
