import { Router } from 'express';
import {
  createAppraisalScoringForm, deleteAppraisalScoringForm, getAppraisalScoringForm, listAppraisalScoringForms,
  setAppraisalScoringFormActive, updateAppraisalScoringForm,
} from '../controllers/appraisal-scoring-forms.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const appraisalScoringFormsRouter = Router();

// Scoring forms are Settings, used while building appraisal forms — admins only (like the forms).
appraisalScoringFormsRouter.get('/appraisal-scoring-forms', authMiddleware, adminMiddleware, asyncHandler(listAppraisalScoringForms));
appraisalScoringFormsRouter.get('/appraisal-scoring-forms/:id', authMiddleware, adminMiddleware, asyncHandler(getAppraisalScoringForm));
appraisalScoringFormsRouter.post('/appraisal-scoring-forms', authMiddleware, adminMiddleware, asyncHandler(createAppraisalScoringForm));
appraisalScoringFormsRouter.put('/appraisal-scoring-forms/:id', authMiddleware, adminMiddleware, asyncHandler(updateAppraisalScoringForm));
appraisalScoringFormsRouter.put('/appraisal-scoring-forms/:id/active', authMiddleware, adminMiddleware, asyncHandler(setAppraisalScoringFormActive));
appraisalScoringFormsRouter.delete('/appraisal-scoring-forms/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAppraisalScoringForm));
