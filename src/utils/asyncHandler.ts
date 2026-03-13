import { Request, Response, NextFunction } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): Handler {
  return (req, res, next) => fn(req, res).catch(next);
}
