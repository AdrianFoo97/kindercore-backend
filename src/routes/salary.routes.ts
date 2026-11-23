import { Router } from 'express';
import {
  getDepartments, upsertDepartment, deleteDepartment,
  getPositions, upsertPosition, deletePosition, setPositionReportsTo,
  getLevelIncentives, upsertLevelIncentives,
  getTeachersWithSalary, getTeacherSalary, getPayrollByMonth, getTeacherWeightsByMonth,
  getEmployerContributions,
} from '../controllers/salary.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { payrollAccess, selfOrTeamPay, hrWithPay } from '../middlewares/teamAccess.middleware.js';

export const salaryRouter = Router();

salaryRouter.get('/departments', authMiddleware, asyncHandler(getDepartments));
salaryRouter.put('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(upsertDepartment));
salaryRouter.delete('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(deleteDepartment));
salaryRouter.get('/positions', authMiddleware, asyncHandler(getPositions));
salaryRouter.put('/positions/:positionId', authMiddleware, hrWithPay(), asyncHandler(upsertPosition));
// Organisational structure: who a position reports to (Settings → HR Planning).
salaryRouter.put('/positions/:positionId/reports-to', authMiddleware, hrWithPay(), asyncHandler(setPositionReportsTo));
salaryRouter.delete('/positions/:positionId', authMiddleware, hrWithPay(), asyncHandler(deletePosition));
salaryRouter.get('/level-incentives', authMiddleware, asyncHandler(getLevelIncentives));
salaryRouter.put('/level-incentives', authMiddleware, hrWithPay(), asyncHandler(upsertLevelIncentives));
salaryRouter.get('/teachers', authMiddleware, payrollAccess(), logSensitiveAccess('PAYROLL'), asyncHandler(getTeachersWithSalary));
// A staff member's own pay (their Pay tab), or HR's view of it.
salaryRouter.get('/teachers/:teacherId', authMiddleware, selfOrTeamPay(), logSensitiveAccess('STAFF_PAY'), asyncHandler(getTeacherSalary));
salaryRouter.get('/payroll-by-month', authMiddleware, payrollAccess(), logSensitiveAccess('PAYROLL'), asyncHandler(getPayrollByMonth));
// Every staff member's profit-share weight, position, level and days worked —
// HR / Finance / Analysis. Teachers get their own share via /teachers/:id/pay-pools.
salaryRouter.get('/teacher-weights-by-month', authMiddleware, payrollAccess(), logSensitiveAccess('PAYROLL'), asyncHandler(getTeacherWeightsByMonth));
salaryRouter.get('/employer-contributions', authMiddleware, payrollAccess(), logSensitiveAccess('PAYROLL'), asyncHandler(getEmployerContributions));
