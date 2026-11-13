import { Router } from 'express';
import {
  activateAppraisalTemplate, createAppraisalTemplate, deleteAppraisalTemplate, getAppraisalTemplate, listAppraisalTemplates,
  newAppraisalTemplateVersion, retireAppraisalTemplate, setAppraisalTemplatePositions, updateAppraisalTemplate,
} from '../controllers/appraisal-templates.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const appraisalTemplatesRouter = Router();

// Appraisal forms are Settings (set up once, rarely changed) — admins only.
// Scoring an appraisal with a form will live under HR with its own rules.
appraisalTemplatesRouter.get('/appraisal-templates', authMiddleware, adminMiddleware, asyncHandler(listAppraisalTemplates));
appraisalTemplatesRouter.post('/appraisal-templates', authMiddleware, adminMiddleware, asyncHandler(createAppraisalTemplate));
appraisalTemplatesRouter.get('/appraisal-templates/:id', authMiddleware, adminMiddleware, asyncHandler(getAppraisalTemplate));
appraisalTemplatesRouter.put('/appraisal-templates/:id', authMiddleware, adminMiddleware, asyncHandler(updateAppraisalTemplate));
appraisalTemplatesRouter.delete('/appraisal-templates/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAppraisalTemplate));
appraisalTemplatesRouter.post('/appraisal-templates/:id/new-version', authMiddleware, adminMiddleware, asyncHandler(newAppraisalTemplateVersion));
appraisalTemplatesRouter.post('/appraisal-templates/:id/activate', authMiddleware, adminMiddleware, asyncHandler(activateAppraisalTemplate));
appraisalTemplatesRouter.post('/appraisal-templates/:id/retire', authMiddleware, adminMiddleware, asyncHandler(retireAppraisalTemplate));
appraisalTemplatesRouter.put('/appraisal-template-families/:familyId/positions', authMiddleware, adminMiddleware, asyncHandler(setAppraisalTemplatePositions));
