import { Router } from 'express';
import {
  listSteps, createStep, updateStep, deleteStep, reorderSteps,
} from '../controllers/sop-steps.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopStepsRouter = Router();

sopStepsRouter.get('/sop-steps', authMiddleware, asyncHandler(listSteps));
sopStepsRouter.post('/sop-steps', authMiddleware, asyncHandler(createStep));
sopStepsRouter.patch('/sop-steps/:id', authMiddleware, asyncHandler(updateStep));
sopStepsRouter.delete('/sop-steps/:id', authMiddleware, asyncHandler(deleteStep));
sopStepsRouter.post('/sop-steps/reorder', authMiddleware, asyncHandler(reorderSteps));
