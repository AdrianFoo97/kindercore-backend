import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory, reorderCategories,
} from '../controllers/sop-categories.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopCategoriesRouter = Router();

// Anyone authenticated can read the label list (used when assigning labels
// to a How-To Guide) — managing the taxonomy itself is admin-only.
sopCategoriesRouter.get('/sop-categories', authMiddleware, asyncHandler(listCategories));
sopCategoriesRouter.post('/sop-categories', authMiddleware, adminMiddleware, asyncHandler(createCategory));
sopCategoriesRouter.patch('/sop-categories/:id', authMiddleware, adminMiddleware, asyncHandler(updateCategory));
sopCategoriesRouter.delete('/sop-categories/:id', authMiddleware, adminMiddleware, asyncHandler(deleteCategory));
sopCategoriesRouter.post('/sop-categories/reorder', authMiddleware, adminMiddleware, asyncHandler(reorderCategories));
