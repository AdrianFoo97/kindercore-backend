import { Router } from 'express';
import { getSettings, updateSetting } from '../controllers/settings.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { settingKeyOwner } from '../middlewares/settingsAccess.middleware.js';

export const settingsRouter = Router();

settingsRouter.get('/', authMiddleware, asyncHandler(getSettings));
settingsRouter.patch('/:key', authMiddleware, settingKeyOwner(), asyncHandler(updateSetting));
