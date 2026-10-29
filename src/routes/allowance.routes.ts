import { Router } from 'express';
import {
  getAllowanceTypes, createAllowanceType, updateAllowanceType, deleteAllowanceType,
  getTeacherAllowances, upsertTeacherAllowances,
} from '../controllers/allowance.controller.js';
import { authMiddleware, requireModule, selfOrModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const allowanceRouter = Router();

allowanceRouter.get('/allowance-types', authMiddleware, asyncHandler(getAllowanceTypes));
allowanceRouter.post('/allowance-types', authMiddleware, adminMiddleware, asyncHandler(createAllowanceType));
allowanceRouter.put('/allowance-types/:id', authMiddleware, adminMiddleware, asyncHandler(updateAllowanceType));
allowanceRouter.delete('/allowance-types/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAllowanceType));
allowanceRouter.get('/teachers/:teacherId/allowances', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getTeacherAllowances));
allowanceRouter.put('/teachers/:teacherId/allowances', authMiddleware, requireModule(MODULES.HR), asyncHandler(upsertTeacherAllowances));
