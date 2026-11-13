import { Router } from 'express';
import { getFinanceSummary } from '../controllers/finance.controller.js';
import { authMiddleware, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const financeRouter = Router();

// The school's revenue, costs and profit — Finance / Analysis only. Teachers
// see their profit-share pools through GET /api/teachers/:id/pay-pools,
// which returns just their own figures (pay-pools.routes).
financeRouter.get('/summary', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), logSensitiveAccess('FINANCE'), asyncHandler(getFinanceSummary));
