import { Router } from 'express';
import { runYearRollover, undoYearRollover, repairRollover } from '../controllers/admin.controller.js';
import { getDbSchema } from '../controllers/db-schema.controller.js';
import { getArchitecture } from '../controllers/architecture.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Admin-only operations (data migrations, year rollover, etc.)
export const adminRouter = Router();

adminRouter.post('/year-rollover', authMiddleware, adminMiddleware, asyncHandler(runYearRollover));
adminRouter.post('/year-rollover/undo', authMiddleware, adminMiddleware, asyncHandler(undoYearRollover));
adminRouter.post('/year-rollover/repair', authMiddleware, adminMiddleware, asyncHandler(repairRollover));

// Live database structure for the Admin → Database Design page (read-only).
adminRouter.get('/db-schema', authMiddleware, adminMiddleware, asyncHandler(getDbSchema));

// Backend layered structure for the Admin → Backend Architecture page (read-only).
adminRouter.get('/architecture', authMiddleware, adminMiddleware, asyncHandler(getArchitecture));
