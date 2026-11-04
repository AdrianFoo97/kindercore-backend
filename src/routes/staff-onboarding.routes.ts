import { Router } from 'express';
import {
  completeStaffOnboarding, getMyOnboarding, listStaffOnboarding, saveStaffOnboarding, startStaffOnboarding, tickMyOnboarding,
} from '../controllers/staff-onboarding.controller.js';
import { authMiddleware, requireModule, selfOrModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const staffOnboardingRouter = Router();

// HR's checklist — ticked by HR, never the staff member themselves.
staffOnboardingRouter.get('/staff-onboarding', authMiddleware, requireModule(MODULES.HR), asyncHandler(listStaffOnboarding));
staffOnboardingRouter.patch('/teachers/:teacherId/onboarding', authMiddleware, requireModule(MODULES.HR), asyncHandler(saveStaffOnboarding));
staffOnboardingRouter.post('/teachers/:teacherId/onboarding/complete', authMiddleware, requireModule(MODULES.HR), asyncHandler(completeStaffOnboarding));
// Put an existing staff member onto onboarding (Staff page → ⋯ → Create Onboarding Tasks).
staffOnboardingRouter.post('/teachers/:teacherId/onboarding/start', authMiddleware, requireModule(MODULES.HR), asyncHandler(startStaffOnboarding));

// The new joiner's own checklist — the teacher themselves, or HR on their behalf.
staffOnboardingRouter.get('/teachers/:teacherId/my-onboarding', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getMyOnboarding));
staffOnboardingRouter.put('/teachers/:teacherId/my-onboarding', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(tickMyOnboarding));
