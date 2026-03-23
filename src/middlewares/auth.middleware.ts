import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPERADMIN') {
    res.status(403).json({ message: 'Forbidden: Admin only' });
    return;
  }
  next();
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET!,
    ) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}
