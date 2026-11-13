import { Router } from 'express';
import {
  listAppraisals, listAppraisalOverview, upsertAppraisal, deleteAppraisal,
} from '../controllers/teacher-appraisals.controller.js';
import { authMiddleware, requireModule, selfOrModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const teacherAppraisalsRouter = Router();

teacherAppraisalsRouter.get('/teachers/:teacherId/appraisals', authMiddleware, selfOrModule(MODULES.HR), logSensitiveAccess('APPRAISALS'), asyncHandler(listAppraisals));
teacherAppraisalsRouter.post('/teachers/:teacherId/appraisals', authMiddleware, requireModule(MODULES.HR), asyncHandler(upsertAppraisal));
teacherAppraisalsRouter.delete('/appraisals/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteAppraisal));
// HR → Appraisals: every current staff member's status for one month.
teacherAppraisalsRouter.get('/appraisals/overview', authMiddleware, requireModule(MODULES.HR), logSensitiveAccess('APPRAISALS'), asyncHandler(listAppraisalOverview));
