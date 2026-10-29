import { Router } from 'express';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  listCategories, createCategory, updateCategory, deleteCategory,
  getEntries, bulkUpsertEntries,
} from '../controllers/operatingCost.controller.js';
import { authMiddleware, requireModule, requireAnyModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const operatingCostRouter = Router();

operatingCostRouter.get('/groups', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(listGroups));
operatingCostRouter.post('/groups', authMiddleware, adminMiddleware, asyncHandler(createGroup));
operatingCostRouter.put('/groups/:id', authMiddleware, adminMiddleware, asyncHandler(updateGroup));
operatingCostRouter.delete('/groups/:id', authMiddleware, adminMiddleware, asyncHandler(deleteGroup));

operatingCostRouter.get('/categories', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(listCategories));
operatingCostRouter.post('/categories', authMiddleware, adminMiddleware, asyncHandler(createCategory));
operatingCostRouter.put('/categories/:id', authMiddleware, adminMiddleware, asyncHandler(updateCategory));
operatingCostRouter.delete('/categories/:id', authMiddleware, adminMiddleware, asyncHandler(deleteCategory));

operatingCostRouter.get('/entries', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(getEntries));
operatingCostRouter.put('/entries', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(bulkUpsertEntries));
