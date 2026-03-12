import { Router } from 'express';
import { getStudents, createStudent, updateStudent, updateOnboardingProgress, completeOnboarding, withdrawStudent, reactivateStudent, deleteStudent } from '../controllers/students.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
export const studentsRouter = Router();
studentsRouter.get('/', authMiddleware, getStudents);
studentsRouter.post('/', authMiddleware, createStudent);
studentsRouter.put('/:id', authMiddleware, updateStudent);
studentsRouter.patch('/:id/onboarding', authMiddleware, updateOnboardingProgress);
studentsRouter.patch('/:id/complete-onboarding', authMiddleware, completeOnboarding);
studentsRouter.patch('/:id/withdraw', authMiddleware, withdrawStudent);
studentsRouter.patch('/:id/reactivate', authMiddleware, reactivateStudent);
studentsRouter.delete('/:id', authMiddleware, deleteStudent);
//# sourceMappingURL=students.routes.js.map