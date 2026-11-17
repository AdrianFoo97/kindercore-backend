import { Router } from 'express';
import {
  acknowledgeAppraisalRun, approveAppraisalRun, cancelAppraisalRun, getAppraisalRun, getMyAppraisalTasks,
  saveAppraisalRunScores, sendBackAppraisalRun, submitAppraisalRun,
} from '../controllers/appraisal-runs.controller.js';
import { authMiddleware, requireAnyModule, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const appraisalRunsRouter = Router();

// HR can cancel one that isn't finished (appraisals are created by the appraisal schedule).
appraisalRunsRouter.delete('/appraisal-runs/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(cancelAppraisalRun));

// The appraisal itself — scorers and sign-offs are staff with the Operation module (or HR);
// the service checks they're on the step they act on, and that the staff member only sees theirs once signed off.
appraisalRunsRouter.get('/appraisal-runs/tasks', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), logSensitiveAccess('APPRAISALS'), asyncHandler(getMyAppraisalTasks));
appraisalRunsRouter.get('/appraisal-runs/:id', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), logSensitiveAccess('APPRAISALS'), asyncHandler(getAppraisalRun));
appraisalRunsRouter.put('/appraisal-runs/:id/scores', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), asyncHandler(saveAppraisalRunScores));
appraisalRunsRouter.post('/appraisal-runs/:id/submit', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), asyncHandler(submitAppraisalRun));
appraisalRunsRouter.post('/appraisal-runs/:id/approve', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), asyncHandler(approveAppraisalRun));
appraisalRunsRouter.post('/appraisal-runs/:id/send-back', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), asyncHandler(sendBackAppraisalRun));
appraisalRunsRouter.post('/appraisal-runs/:id/acknowledge', authMiddleware, requireAnyModule(MODULES.HR, MODULES.OPERATION), asyncHandler(acknowledgeAppraisalRun));
