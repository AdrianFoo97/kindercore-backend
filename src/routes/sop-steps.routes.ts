import { Router } from 'express';
import {
  listSteps, createStep, updateStep, deleteStep, reorderSteps,
} from '../controllers/sop-steps.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopStepsRouter = Router();

sopStepsRouter.get('/sop-steps', authMiddleware, asyncHandler(listSteps));
sopStepsRouter.post('/sop-steps', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(createStep));
sopStepsRouter.patch('/sop-steps/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(updateStep));
sopStepsRouter.delete('/sop-steps/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(deleteStep));
sopStepsRouter.post('/sop-steps/reorder', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(reorderSteps));
