import { Router } from 'express';
import {
  createAppraisalScoringForm, deleteAppraisalScoringForm, getAppraisalScoringForm, listAppraisalScoringForms,
  setAppraisalScoringFormActive, updateAppraisalScoringForm,
} from '../controllers/appraisal-scoring-forms.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const appraisalScoringFormsRouter = Router();

// Scoring forms are Settings, used while building appraisal forms — admins only (like the forms).
appraisalScoringFormsRouter.get('/appraisal-scoring-forms', authMiddleware, wholeSchoolHr(), asyncHandler(listAppraisalScoringForms));
appraisalScoringFormsRouter.get('/appraisal-scoring-forms/:id', authMiddleware, wholeSchoolHr(), asyncHandler(getAppraisalScoringForm));
appraisalScoringFormsRouter.post('/appraisal-scoring-forms', authMiddleware, wholeSchoolHr(), asyncHandler(createAppraisalScoringForm));
appraisalScoringFormsRouter.put('/appraisal-scoring-forms/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateAppraisalScoringForm));
appraisalScoringFormsRouter.put('/appraisal-scoring-forms/:id/active', authMiddleware, wholeSchoolHr(), asyncHandler(setAppraisalScoringFormActive));
appraisalScoringFormsRouter.delete('/appraisal-scoring-forms/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteAppraisalScoringForm));
