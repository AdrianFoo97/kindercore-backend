import { Router } from 'express';
import { getFinanceSummary } from '../controllers/finance.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const financeRouter = Router();

financeRouter.get('/summary', authMiddleware, asyncHandler(getFinanceSummary));
