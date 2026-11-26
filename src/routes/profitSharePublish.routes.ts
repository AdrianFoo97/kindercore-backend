import { Router } from 'express';
import { getPublications, postPublish, postUnpublish } from '../controllers/profitSharePublish.controller.js';
import { authMiddleware, requireModule, requireView } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { PROFIT_PUBLISH_FUNCTION } from '../constants/accessRoles.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const profitSharePublishRouter = Router();

// Analysis → Profit Sharing: each month's pool and whether it's published (the
// page's own module), and publishing / taking back (the Finance Manager's function).
profitSharePublishRouter.get('/profit-sharing/publications', authMiddleware, requireModule(MODULES.ANALYSIS), logSensitiveAccess('FINANCE'), asyncHandler(getPublications));
profitSharePublishRouter.post('/profit-sharing/publications/:year/:month/publish', authMiddleware, requireView(PROFIT_PUBLISH_FUNCTION), asyncHandler(postPublish));
profitSharePublishRouter.post('/profit-sharing/publications/:year/:month/unpublish', authMiddleware, requireView(PROFIT_PUBLISH_FUNCTION), asyncHandler(postUnpublish));
