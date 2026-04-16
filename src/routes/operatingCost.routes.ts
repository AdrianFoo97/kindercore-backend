import { Router } from 'express';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  listCategories, createCategory, updateCategory, deleteCategory,
  getEntries, bulkUpsertEntries,
} from '../controllers/operatingCost.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const operatingCostRouter = Router();

operatingCostRouter.get('/groups', authMiddleware, asyncHandler(listGroups));
operatingCostRouter.post('/groups', authMiddleware, asyncHandler(createGroup));
operatingCostRouter.put('/groups/:id', authMiddleware, asyncHandler(updateGroup));
operatingCostRouter.delete('/groups/:id', authMiddleware, asyncHandler(deleteGroup));

operatingCostRouter.get('/categories', authMiddleware, asyncHandler(listCategories));
operatingCostRouter.post('/categories', authMiddleware, asyncHandler(createCategory));
operatingCostRouter.put('/categories/:id', authMiddleware, asyncHandler(updateCategory));
operatingCostRouter.delete('/categories/:id', authMiddleware, asyncHandler(deleteCategory));

operatingCostRouter.get('/entries', authMiddleware, asyncHandler(getEntries));
operatingCostRouter.put('/entries', authMiddleware, asyncHandler(bulkUpsertEntries));
