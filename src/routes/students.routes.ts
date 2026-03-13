import { Router } from 'express';
import { getStudents, createStudent, updateStudent, updateOnboardingProgress, completeOnboarding, withdrawStudent, reactivateStudent, deleteStudent } from '../controllers/students.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const studentsRouter = Router();

studentsRouter.get('/', authMiddleware, asyncHandler(getStudents));
studentsRouter.post('/', authMiddleware, asyncHandler(createStudent));
studentsRouter.put('/:id', authMiddleware, asyncHandler(updateStudent));
studentsRouter.patch('/:id/onboarding', authMiddleware, asyncHandler(updateOnboardingProgress));
studentsRouter.patch('/:id/complete-onboarding', authMiddleware, asyncHandler(completeOnboarding));
studentsRouter.patch('/:id/withdraw', authMiddleware, asyncHandler(withdrawStudent));
studentsRouter.patch('/:id/reactivate', authMiddleware, asyncHandler(reactivateStudent));
studentsRouter.delete('/:id', authMiddleware, asyncHandler(deleteStudent));
