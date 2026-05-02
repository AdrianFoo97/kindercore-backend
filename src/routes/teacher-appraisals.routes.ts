import { Router } from 'express';
import {
  listAppraisals, upsertAppraisal, deleteAppraisal,
} from '../controllers/teacher-appraisals.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const teacherAppraisalsRouter = Router();

teacherAppraisalsRouter.get('/teachers/:teacherId/appraisals', authMiddleware, asyncHandler(listAppraisals));
teacherAppraisalsRouter.post('/teachers/:teacherId/appraisals', authMiddleware, asyncHandler(upsertAppraisal));
teacherAppraisalsRouter.delete('/appraisals/:id', authMiddleware, asyncHandler(deleteAppraisal));
