import { Router } from 'express';
import { getTeacherPayPools } from '../controllers/finance.controller.js';
import { authMiddleware, selfOrModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const payPoolsRouter = Router();

// A teacher's own team-pool / annual-bonus progress: the teacher, HR or Admin.
payPoolsRouter.get('/teachers/:teacherId/pay-pools', authMiddleware, selfOrModule(MODULES.HR), logSensitiveAccess('STAFF_PAY'), asyncHandler(getTeacherPayPools));
