import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory, reorderCategories,
} from '../controllers/mission-categories.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MODULES } from '../constants/authModules.js';

export const missionCategoriesRouter = Router();

missionCategoriesRouter.get('/mission-categories', authMiddleware, asyncHandler(listCategories));
missionCategoriesRouter.post('/mission-categories', authMiddleware, requireModule(MODULES.HR), asyncHandler(createCategory));
missionCategoriesRouter.patch('/mission-categories/:code', authMiddleware, requireModule(MODULES.HR), asyncHandler(updateCategory));
missionCategoriesRouter.delete('/mission-categories/:code', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteCategory));
missionCategoriesRouter.post('/mission-categories/reorder', authMiddleware, requireModule(MODULES.HR), asyncHandler(reorderCategories));
