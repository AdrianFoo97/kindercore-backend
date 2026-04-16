import { Router } from 'express';
import {
  getPositions, upsertPosition, deletePosition,
  getLevelIncentives, upsertLevelIncentives,
  getTeachersWithSalary, getPayrollByMonth, getTeacherWeightsByMonth,
  getEmployerContributions,
} from '../controllers/salary.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const salaryRouter = Router();

salaryRouter.get('/positions', authMiddleware, asyncHandler(getPositions));
salaryRouter.put('/positions/:positionId', authMiddleware, asyncHandler(upsertPosition));
salaryRouter.delete('/positions/:positionId', authMiddleware, asyncHandler(deletePosition));
salaryRouter.get('/level-incentives', authMiddleware, asyncHandler(getLevelIncentives));
salaryRouter.put('/level-incentives', authMiddleware, asyncHandler(upsertLevelIncentives));
salaryRouter.get('/teachers', authMiddleware, asyncHandler(getTeachersWithSalary));
salaryRouter.get('/payroll-by-month', authMiddleware, asyncHandler(getPayrollByMonth));
salaryRouter.get('/teacher-weights-by-month', authMiddleware, asyncHandler(getTeacherWeightsByMonth));
salaryRouter.get('/employer-contributions', authMiddleware, asyncHandler(getEmployerContributions));
