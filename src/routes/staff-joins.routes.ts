import { Router } from 'express';
import { approveStaffJoin, listStaffJoins, rejectStaffJoin, submitStaffJoin } from '../controllers/staff-joins.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const staffJoinsRouter = Router();

// The "New staff" form is public (rate-limited in server.ts); reviewing it
// is HR's job, the same module that owns Recruitment → Hire.
staffJoinsRouter.post('/staff-joins', asyncHandler(submitStaffJoin));
staffJoinsRouter.get('/staff-joins', authMiddleware, wholeSchoolHr(), asyncHandler(listStaffJoins));
staffJoinsRouter.post('/staff-joins/:id/approve', authMiddleware, wholeSchoolHr(), asyncHandler(approveStaffJoin));
staffJoinsRouter.post('/staff-joins/:id/reject', authMiddleware, wholeSchoolHr(), asyncHandler(rejectStaffJoin));
