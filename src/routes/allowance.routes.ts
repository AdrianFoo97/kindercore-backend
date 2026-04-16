import { Router } from 'express';
import {
  getAllowanceTypes, createAllowanceType, updateAllowanceType, deleteAllowanceType,
  getTeacherAllowances, upsertTeacherAllowances,
} from '../controllers/allowance.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const allowanceRouter = Router();

allowanceRouter.get('/allowance-types', authMiddleware, asyncHandler(getAllowanceTypes));
allowanceRouter.post('/allowance-types', authMiddleware, asyncHandler(createAllowanceType));
allowanceRouter.put('/allowance-types/:id', authMiddleware, asyncHandler(updateAllowanceType));
allowanceRouter.delete('/allowance-types/:id', authMiddleware, asyncHandler(deleteAllowanceType));
allowanceRouter.get('/teachers/:teacherId/allowances', authMiddleware, asyncHandler(getTeacherAllowances));
allowanceRouter.put('/teachers/:teacherId/allowances', authMiddleware, asyncHandler(upsertTeacherAllowances));
