import { Router } from 'express';
import {
  listLeadLabels, createLeadLabel, updateLeadLabel, deleteLeadLabel,
} from '../controllers/lead-labels.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leadLabelsRouter = Router();

leadLabelsRouter.get('/lead-labels', authMiddleware, asyncHandler(listLeadLabels));
leadLabelsRouter.post('/lead-labels', authMiddleware, asyncHandler(createLeadLabel));
leadLabelsRouter.patch('/lead-labels/:id', authMiddleware, asyncHandler(updateLeadLabel));
leadLabelsRouter.delete('/lead-labels/:id', authMiddleware, asyncHandler(deleteLeadLabel));
