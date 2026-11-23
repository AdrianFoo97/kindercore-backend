import { Router } from 'express';
import {
  completeStaffOnboarding, saveOwnOnboardingSteps, getMyOnboarding, listStaffOnboarding, saveStaffOnboarding, startStaffOnboarding, tickMyOnboarding,
} from '../controllers/staff-onboarding.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { selfOrTeam, wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const staffOnboardingRouter = Router();

// HR's checklist — ticked by HR, never the staff member themselves.
staffOnboardingRouter.get('/staff-onboarding', authMiddleware, wholeSchoolHr(), asyncHandler(listStaffOnboarding));
staffOnboardingRouter.patch('/teachers/:teacherId/onboarding', authMiddleware, wholeSchoolHr(), asyncHandler(saveStaffOnboarding));
staffOnboardingRouter.post('/teachers/:teacherId/onboarding/complete', authMiddleware, wholeSchoolHr(), asyncHandler(completeStaffOnboarding));
// HR updates a joiner's own checklist to the latest steps (the joiner can only tick it).
staffOnboardingRouter.put('/teachers/:teacherId/onboarding/own-steps', authMiddleware, wholeSchoolHr(), asyncHandler(saveOwnOnboardingSteps));
// Put an existing staff member onto onboarding (Staff page → ⋯ → Create Onboarding Tasks).
staffOnboardingRouter.post('/teachers/:teacherId/onboarding/start', authMiddleware, wholeSchoolHr(), asyncHandler(startStaffOnboarding));

// The new joiner's own checklist — the teacher themselves, or HR on their behalf.
staffOnboardingRouter.get('/teachers/:teacherId/my-onboarding', authMiddleware, selfOrTeam(), asyncHandler(getMyOnboarding));
staffOnboardingRouter.put('/teachers/:teacherId/my-onboarding', authMiddleware, selfOrTeam(), asyncHandler(tickMyOnboarding));
