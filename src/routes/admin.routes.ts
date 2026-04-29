import { Router } from 'express';
import { runYearRollover, undoYearRollover, repairRollover } from '../controllers/admin.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Admin-only operations (data migrations, year rollover, etc.)
export const adminRouter = Router();

adminRouter.post('/year-rollover', authMiddleware, adminMiddleware, asyncHandler(runYearRollover));
adminRouter.post('/year-rollover/undo', authMiddleware, adminMiddleware, asyncHandler(undoYearRollover));
adminRouter.post('/year-rollover/repair', authMiddleware, adminMiddleware, asyncHandler(repairRollover));
