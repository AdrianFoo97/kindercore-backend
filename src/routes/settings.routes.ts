import { Router } from 'express';
import { getSettings, updateSetting } from '../controllers/settings.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const settingsRouter = Router();

settingsRouter.get('/', authMiddleware, asyncHandler(getSettings));
settingsRouter.patch('/:key', authMiddleware, adminMiddleware, asyncHandler(updateSetting));
