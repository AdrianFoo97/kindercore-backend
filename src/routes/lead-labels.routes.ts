import { Router } from 'express';
import {
  listLeadLabels, createLeadLabel, updateLeadLabel, deleteLeadLabel,
} from '../controllers/lead-labels.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leadLabelsRouter = Router();

leadLabelsRouter.get('/lead-labels', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(listLeadLabels));
leadLabelsRouter.post('/lead-labels', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(createLeadLabel));
leadLabelsRouter.patch('/lead-labels/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(updateLeadLabel));
leadLabelsRouter.delete('/lead-labels/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(deleteLeadLabel));
