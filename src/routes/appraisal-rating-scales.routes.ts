import { Router } from 'express';
import {
  createAppraisalRatingScale, deleteAppraisalRatingScale, listAppraisalRatingScales, setAppraisalRatingScaleActive, setDefaultAppraisalRatingScale, updateAppraisalRatingScale,
} from '../controllers/appraisal-rating-scales.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const appraisalRatingScalesRouter = Router();

// Rating scales are Settings, used while building appraisal forms — admins only (like the forms).
appraisalRatingScalesRouter.get('/appraisal-rating-scales', authMiddleware, adminMiddleware, asyncHandler(listAppraisalRatingScales));
appraisalRatingScalesRouter.post('/appraisal-rating-scales', authMiddleware, adminMiddleware, asyncHandler(createAppraisalRatingScale));
appraisalRatingScalesRouter.put('/appraisal-rating-scales/:id', authMiddleware, adminMiddleware, asyncHandler(updateAppraisalRatingScale));
appraisalRatingScalesRouter.delete('/appraisal-rating-scales/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAppraisalRatingScale));
appraisalRatingScalesRouter.put('/appraisal-rating-scales/:id/active', authMiddleware, adminMiddleware, asyncHandler(setAppraisalRatingScaleActive));
appraisalRatingScalesRouter.post('/appraisal-rating-scales/:id/default', authMiddleware, adminMiddleware, asyncHandler(setDefaultAppraisalRatingScale));
