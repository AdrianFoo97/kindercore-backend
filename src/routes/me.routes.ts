import { Router } from 'express';
import { getMyPermissions } from '../controllers/me.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const meRouter = Router();

meRouter.get('/me/permissions', authMiddleware, asyncHandler(getMyPermissions));
