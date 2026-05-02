import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory, reorderCategories,
} from '../controllers/mission-categories.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const missionCategoriesRouter = Router();

missionCategoriesRouter.get('/mission-categories', authMiddleware, asyncHandler(listCategories));
missionCategoriesRouter.post('/mission-categories', authMiddleware, asyncHandler(createCategory));
missionCategoriesRouter.patch('/mission-categories/:code', authMiddleware, asyncHandler(updateCategory));
missionCategoriesRouter.delete('/mission-categories/:code', authMiddleware, asyncHandler(deleteCategory));
missionCategoriesRouter.post('/mission-categories/reorder', authMiddleware, asyncHandler(reorderCategories));
