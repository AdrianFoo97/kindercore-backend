import { Router } from 'express';
import {
  activateAppraisalTemplate, createAppraisalTemplate, deleteAppraisalTemplate, getAppraisalTemplate, listAppraisalTemplates,
  newAppraisalTemplateVersion, retireAppraisalTemplate, setAppraisalTemplatePositions, updateAppraisalTemplate,
} from '../controllers/appraisal-templates.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const appraisalTemplatesRouter = Router();

// Appraisal forms are Settings (set up once, rarely changed) — admins only.
// Scoring an appraisal with a form will live under HR with its own rules.
appraisalTemplatesRouter.get('/appraisal-templates', authMiddleware, wholeSchoolHr(), asyncHandler(listAppraisalTemplates));
appraisalTemplatesRouter.post('/appraisal-templates', authMiddleware, wholeSchoolHr(), asyncHandler(createAppraisalTemplate));
appraisalTemplatesRouter.get('/appraisal-templates/:id', authMiddleware, wholeSchoolHr(), asyncHandler(getAppraisalTemplate));
appraisalTemplatesRouter.put('/appraisal-templates/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateAppraisalTemplate));
appraisalTemplatesRouter.delete('/appraisal-templates/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteAppraisalTemplate));
appraisalTemplatesRouter.post('/appraisal-templates/:id/new-version', authMiddleware, wholeSchoolHr(), asyncHandler(newAppraisalTemplateVersion));
appraisalTemplatesRouter.post('/appraisal-templates/:id/activate', authMiddleware, wholeSchoolHr(), asyncHandler(activateAppraisalTemplate));
appraisalTemplatesRouter.post('/appraisal-templates/:id/retire', authMiddleware, wholeSchoolHr(), asyncHandler(retireAppraisalTemplate));
appraisalTemplatesRouter.put('/appraisal-template-families/:familyId/positions', authMiddleware, wholeSchoolHr(), asyncHandler(setAppraisalTemplatePositions));
