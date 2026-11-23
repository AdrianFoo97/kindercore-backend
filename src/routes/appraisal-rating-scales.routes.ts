import { Router } from 'express';
import {
  createAppraisalRatingScale, deleteAppraisalRatingScale, listAppraisalRatingScales, setAppraisalRatingScaleActive, setDefaultAppraisalRatingScale, updateAppraisalRatingScale,
} from '../controllers/appraisal-rating-scales.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const appraisalRatingScalesRouter = Router();

// Rating scales are Settings, used while building appraisal forms — admins only (like the forms).
appraisalRatingScalesRouter.get('/appraisal-rating-scales', authMiddleware, wholeSchoolHr(), asyncHandler(listAppraisalRatingScales));
appraisalRatingScalesRouter.post('/appraisal-rating-scales', authMiddleware, wholeSchoolHr(), asyncHandler(createAppraisalRatingScale));
appraisalRatingScalesRouter.put('/appraisal-rating-scales/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateAppraisalRatingScale));
appraisalRatingScalesRouter.delete('/appraisal-rating-scales/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteAppraisalRatingScale));
appraisalRatingScalesRouter.put('/appraisal-rating-scales/:id/active', authMiddleware, wholeSchoolHr(), asyncHandler(setAppraisalRatingScaleActive));
appraisalRatingScalesRouter.post('/appraisal-rating-scales/:id/default', authMiddleware, wholeSchoolHr(), asyncHandler(setDefaultAppraisalRatingScale));
