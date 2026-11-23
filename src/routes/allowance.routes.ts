import { Router } from 'express';
import {
  getAllowanceTypes, createAllowanceType, updateAllowanceType, deleteAllowanceType,
  getTeacherAllowances, upsertTeacherAllowances,
} from '../controllers/allowance.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { selfOrTeamPay, teamPay, hrWithPay } from '../middlewares/teamAccess.middleware.js';

export const allowanceRouter = Router();

allowanceRouter.get('/allowance-types', authMiddleware, asyncHandler(getAllowanceTypes));
allowanceRouter.post('/allowance-types', authMiddleware, hrWithPay(), asyncHandler(createAllowanceType));
allowanceRouter.put('/allowance-types/:id', authMiddleware, hrWithPay(), asyncHandler(updateAllowanceType));
allowanceRouter.delete('/allowance-types/:id', authMiddleware, hrWithPay(), asyncHandler(deleteAllowanceType));
allowanceRouter.get('/teachers/:teacherId/allowances', authMiddleware, selfOrTeamPay(), logSensitiveAccess('STAFF_PAY'), asyncHandler(getTeacherAllowances));
allowanceRouter.put('/teachers/:teacherId/allowances', authMiddleware, teamPay(), asyncHandler(upsertTeacherAllowances));
