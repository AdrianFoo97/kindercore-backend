import { Router } from 'express';
import { approveStaffJoin, listStaffJoins, rejectStaffJoin, submitStaffJoin } from '../controllers/staff-joins.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const staffJoinsRouter = Router();

// The "New staff" form is public (rate-limited in server.ts); reviewing it
// is HR's job, the same module that owns Recruitment → Hire.
staffJoinsRouter.post('/staff-joins', asyncHandler(submitStaffJoin));
staffJoinsRouter.get('/staff-joins', authMiddleware, requireModule(MODULES.HR), asyncHandler(listStaffJoins));
staffJoinsRouter.post('/staff-joins/:id/approve', authMiddleware, requireModule(MODULES.HR), asyncHandler(approveStaffJoin));
staffJoinsRouter.post('/staff-joins/:id/reject', authMiddleware, requireModule(MODULES.HR), asyncHandler(rejectStaffJoin));
