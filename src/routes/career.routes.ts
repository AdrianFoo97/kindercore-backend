import { Router } from 'express';
import {
  getCareerRecords, createCareerRecord, updateCareerRecord, deleteCareerRecord,
  getCareerRecordsByYear,
} from '../controllers/career.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const careerRouter = Router();

careerRouter.get('/career-records', authMiddleware, asyncHandler(getCareerRecordsByYear));
careerRouter.get('/teachers/:teacherId/career', authMiddleware, asyncHandler(getCareerRecords));
careerRouter.post('/teachers/:teacherId/career', authMiddleware, asyncHandler(createCareerRecord));
careerRouter.put('/career/:id', authMiddleware, asyncHandler(updateCareerRecord));
careerRouter.delete('/career/:id', authMiddleware, asyncHandler(deleteCareerRecord));
