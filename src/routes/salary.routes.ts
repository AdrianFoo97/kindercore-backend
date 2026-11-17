import { Router } from 'express';
import {
  getDepartments, upsertDepartment, deleteDepartment,
  getPositions, upsertPosition, deletePosition, setPositionReportsTo,
  getLevelIncentives, upsertLevelIncentives,
  getTeachersWithSalary, getTeacherSalary, getPayrollByMonth, getTeacherWeightsByMonth,
  getEmployerContributions,
} from '../controllers/salary.controller.js';
import { authMiddleware, requireAnyModule, adminMiddleware, selfOrModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const salaryRouter = Router();

salaryRouter.get('/departments', authMiddleware, asyncHandler(getDepartments));
salaryRouter.put('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(upsertDepartment));
salaryRouter.delete('/departments/:departmentId', authMiddleware, adminMiddleware, asyncHandler(deleteDepartment));
salaryRouter.get('/positions', authMiddleware, asyncHandler(getPositions));
salaryRouter.put('/positions/:positionId', authMiddleware, adminMiddleware, asyncHandler(upsertPosition));
// Organisational structure: who a position reports to (Settings → HR Planning).
salaryRouter.put('/positions/:positionId/reports-to', authMiddleware, adminMiddleware, asyncHandler(setPositionReportsTo));
salaryRouter.delete('/positions/:positionId', authMiddleware, adminMiddleware, asyncHandler(deletePosition));
salaryRouter.get('/level-incentives', authMiddleware, asyncHandler(getLevelIncentives));
salaryRouter.put('/level-incentives', authMiddleware, adminMiddleware, asyncHandler(upsertLevelIncentives));
salaryRouter.get('/teachers', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), logSensitiveAccess('PAYROLL'), asyncHandler(getTeachersWithSalary));
// A staff member's own pay (their Pay tab), or HR's view of it.
salaryRouter.get('/teachers/:teacherId', authMiddleware, selfOrModule(MODULES.HR), logSensitiveAccess('STAFF_PAY'), asyncHandler(getTeacherSalary));
salaryRouter.get('/payroll-by-month', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), logSensitiveAccess('PAYROLL'), asyncHandler(getPayrollByMonth));
// Every staff member's profit-share weight, position, level and days worked —
// HR / Finance / Analysis. Teachers get their own share via /teachers/:id/pay-pools.
salaryRouter.get('/teacher-weights-by-month', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), logSensitiveAccess('PAYROLL'), asyncHandler(getTeacherWeightsByMonth));
salaryRouter.get('/employer-contributions', authMiddleware, requireAnyModule(MODULES.HR, MODULES.FINANCE, MODULES.ANALYSIS), logSensitiveAccess('PAYROLL'), asyncHandler(getEmployerContributions));
