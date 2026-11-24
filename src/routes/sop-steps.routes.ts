import { Router } from 'express';
import {
  listSteps, createStep, updateStep, deleteStep, reorderSteps, uploadStepImage, getStepImage,
} from '../controllers/sop-steps.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { guideStepImageUpload } from '../services/guideStepImages.service.js';

export const sopStepsRouter = Router();

sopStepsRouter.get('/sop-steps', authMiddleware, asyncHandler(listSteps));
// Step photos — anyone who can suggest a guide change can add one; staff see them on the guide.
sopStepsRouter.post('/sop-steps/images', authMiddleware, guideStepImageUpload, asyncHandler(uploadStepImage));
sopStepsRouter.get('/sop-steps/images/:id', authMiddleware, asyncHandler(getStepImage));
sopStepsRouter.post('/sop-steps', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(createStep));
sopStepsRouter.patch('/sop-steps/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(updateStep));
sopStepsRouter.delete('/sop-steps/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(deleteStep));
sopStepsRouter.post('/sop-steps/reorder', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(reorderSteps));
