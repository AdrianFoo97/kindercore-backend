import { Router } from 'express';
import {
  getDepartments, upsertDepartment, deleteDepartment,
  getPositions, upsertPosition, deletePosition,
  getLevelIncentives, upsertLevelIncentives,
  getTeachersWithSalary, getPayrollByMonth, getTeacherWeightsByMonth,
  getEmployerContributions,
} from '../controllers/salary.controller.js';
import { authMiddleware, requireAnyModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const salaryRouter = Router();

salaryRouter.get('/departments', authMiddleware, asyncHandler(getDepartments));
salaryRouter.put('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(upsertDepartment));
salaryRouter.delete('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(deleteDepartment));
salaryRouter.get('/positions', authMiddleware, asyncHandler(getPositions));
salaryRouter.put('/positions/:positionId', authMiddleware, adminMiddleware, asyncHandler(upsertPosition));
salaryRouter.delete('/positions/:positionId', authMiddleware, adminMiddleware, asyncHandler(deletePosition));
salaryRouter.get('/level-incentives', authMiddleware, asyncHandler(getLevelIncentives));
salaryRouter.put('/level-incentives', authMiddleware, adminMiddleware, asyncHandler(upsertLevelIncentives));
salaryRouter.get('/teachers', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(getTeachersWithSalary));
salaryRouter.get('/payroll-by-month', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(getPayrollByMonth));
salaryRouter.get('/teacher-weights-by-month', authMiddleware, asyncHandler(getTeacherWeightsByMonth));
salaryRouter.get('/employer-contributions', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(getEmployerContributions));
