import { Router } from 'express';
import { getStudents, getRevenueAnalytics, createStudent, createStudentWithLead, createSibling, updateStudent, updateOnboardingProgress, completeOnboarding, withdrawStudent, reactivateStudent, deleteStudent, resetAllStudents } from '../controllers/students.controller.js';
import { getEnrollmentsForStudent, createEnrollment } from '../controllers/enrollments.controller.js';
import { authMiddleware, adminMiddleware, requireModule, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const studentsRouter = Router();

studentsRouter.get('/', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(getStudents));
studentsRouter.get('/revenue-analytics', authMiddleware, requireAnyModule(MODULES.STUDENTS, MODULES.ANALYSIS, MODULES.FINANCE), asyncHandler(getRevenueAnalytics));
studentsRouter.post('/', authMiddleware, requireAnyModule(MODULES.STUDENTS, MODULES.MARKETING), asyncHandler(createStudent));
studentsRouter.post('/with-lead', authMiddleware, requireAnyModule(MODULES.STUDENTS, MODULES.MARKETING), asyncHandler(createStudentWithLead));
studentsRouter.post('/sibling', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(createSibling));
studentsRouter.put('/:id', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(updateStudent));
studentsRouter.patch('/:id/onboarding', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(updateOnboardingProgress));
studentsRouter.patch('/:id/complete-onboarding', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(completeOnboarding));
studentsRouter.patch('/:id/withdraw', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(withdrawStudent));
studentsRouter.patch('/:id/reactivate', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(reactivateStudent));
studentsRouter.delete('/reset', authMiddleware, adminMiddleware, asyncHandler(resetAllStudents));
studentsRouter.delete('/:id', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(deleteStudent));

// Enrollment history (per student): list + open new period.
studentsRouter.get('/:id/enrollments', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(getEnrollmentsForStudent));
studentsRouter.post('/:id/enrollments', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(createEnrollment));
