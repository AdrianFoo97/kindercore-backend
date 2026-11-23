import { Router } from 'express';
import { getTeacherPayPools } from '../controllers/finance.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { selfOrTeamPay } from '../middlewares/teamAccess.middleware.js';

export const payPoolsRouter = Router();

// A teacher's own team-pool / annual-bonus progress: the teacher, HR or Admin.
payPoolsRouter.get('/teachers/:teacherId/pay-pools', authMiddleware, selfOrTeamPay(), logSensitiveAccess('STAFF_PAY'), asyncHandler(getTeacherPayPools));
