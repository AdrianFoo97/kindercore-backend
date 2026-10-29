import { Router } from 'express';
import {
  getCareerRecords, createCareerRecord, updateCareerRecord, deleteCareerRecord,
  getCareerRecordsByYear,
} from '../controllers/career.controller.js';
import { authMiddleware, requireModule, requireAnyModule, selfOrModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const careerRouter = Router();

careerRouter.get('/career-records', authMiddleware, requireAnyModule(MODULES.HR, MODULES.ANALYSIS), asyncHandler(getCareerRecordsByYear));
careerRouter.get('/teachers/:teacherId/career', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getCareerRecords));
careerRouter.post('/teachers/:teacherId/career', authMiddleware, requireModule(MODULES.HR), asyncHandler(createCareerRecord));
careerRouter.put('/career/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(updateCareerRecord));
careerRouter.delete('/career/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteCareerRecord));
