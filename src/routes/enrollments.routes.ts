import { Router } from 'express';
import { updateEnrollment, deleteEnrollment } from '../controllers/enrollments.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Enrollment-by-id routes (corrections / hard-delete). The per-student
// "list + create new period" routes live under students.routes.ts.
export const enrollmentsRouter = Router();

enrollmentsRouter.patch('/:id', authMiddleware, asyncHandler(updateEnrollment));
enrollmentsRouter.delete('/:id', authMiddleware, asyncHandler(deleteEnrollment));
