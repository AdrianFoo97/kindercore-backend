import { Router } from 'express';
import { getStudents, getRevenueAnalytics, createStudent, createStudentWithLead, updateStudent, updateOnboardingProgress, completeOnboarding, withdrawStudent, reactivateStudent, deleteStudent, resetAllStudents } from '../controllers/students.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const studentsRouter = Router();

studentsRouter.get('/', authMiddleware, asyncHandler(getStudents));
studentsRouter.get('/revenue-analytics', authMiddleware, asyncHandler(getRevenueAnalytics));
studentsRouter.post('/', authMiddleware, asyncHandler(createStudent));
studentsRouter.post('/with-lead', authMiddleware, asyncHandler(createStudentWithLead));
studentsRouter.put('/:id', authMiddleware, asyncHandler(updateStudent));
studentsRouter.patch('/:id/onboarding', authMiddleware, asyncHandler(updateOnboardingProgress));
studentsRouter.patch('/:id/complete-onboarding', authMiddleware, asyncHandler(completeOnboarding));
studentsRouter.patch('/:id/withdraw', authMiddleware, asyncHandler(withdrawStudent));
studentsRouter.patch('/:id/reactivate', authMiddleware, asyncHandler(reactivateStudent));
studentsRouter.delete('/reset', authMiddleware, adminMiddleware, asyncHandler(resetAllStudents));
studentsRouter.delete('/:id', authMiddleware, asyncHandler(deleteStudent));
