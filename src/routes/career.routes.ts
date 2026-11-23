import { Router } from 'express';
import {
  getCareerRecords, createCareerRecord, updateCareerRecord, deleteCareerRecord,
  getCareerRecordsByYear,
} from '../controllers/career.controller.js';
import { authMiddleware, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { payrollAccess, selfOrTeam, teamPay, wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const careerRouter = Router();

careerRouter.get('/career-records', authMiddleware, requireAnyModule(MODULES.HR, MODULES.ANALYSIS), asyncHandler(getCareerRecordsByYear));
careerRouter.get('/teachers/:teacherId/career', authMiddleware, selfOrTeam(), asyncHandler(getCareerRecords));
careerRouter.post('/teachers/:teacherId/career', authMiddleware, teamPay(), asyncHandler(createCareerRecord));
careerRouter.put('/career/:id', authMiddleware, wholeSchoolHr(), payrollAccess(), asyncHandler(updateCareerRecord));
careerRouter.delete('/career/:id', authMiddleware, wholeSchoolHr(), payrollAccess(), asyncHandler(deleteCareerRecord));
