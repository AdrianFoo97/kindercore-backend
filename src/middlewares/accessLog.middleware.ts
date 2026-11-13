import type { NextFunction, Request, Response } from 'express';
import { recordAccess, type AccessArea } from '../services/accessLog.service.js';

/**
 * Records who opened a sensitive record (Admin → Access Log). Put it after
 * the route's access gate: it only records views that succeeded, and never
 * someone opening their own record (e.g. a teacher's own pay).
 */
export function logSensitiveAccess(area: AccessArea, subjectParam = 'teacherId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      const user = req.user;
      if (!user || res.statusCode >= 400) return;
      const subject = req.params?.[subjectParam] ?? null;
      if (subject && subject === user.teacherId) return; // their own record
      void recordAccess({
        userId: user.id,
        userEmail: user.email,
        area,
        action: `${req.method} ${(req.baseUrl ?? '') + (req.route?.path ?? req.path)}`.slice(0, 191),
        subjectTeacherId: subject,
        ip: req.ip ?? null,
      });
    });
    next();
  };
}
