import { Router } from 'express';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, reorderTemplates,
} from '../controllers/sop-templates.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopTemplatesRouter = Router();

sopTemplatesRouter.get('/sop-templates', authMiddleware, asyncHandler(listTemplates));
sopTemplatesRouter.post('/sop-templates', authMiddleware, asyncHandler(createTemplate));
sopTemplatesRouter.patch('/sop-templates/:id', authMiddleware, asyncHandler(updateTemplate));
sopTemplatesRouter.delete('/sop-templates/:id', authMiddleware, asyncHandler(deleteTemplate));
sopTemplatesRouter.post('/sop-templates/reorder', authMiddleware, asyncHandler(reorderTemplates));
