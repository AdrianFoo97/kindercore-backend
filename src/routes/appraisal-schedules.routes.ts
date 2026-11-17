import { Router } from 'express';
import {
  createAppraisalNow, createAppraisalSchedules, deleteAppraisalSchedule, getAppraisalSchedules, getCreatedAppraisals, getPerformanceStaff, startAppraisalOneOff,
} from '../controllers/appraisal-schedules.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const appraisalSchedulesRouter = Router();

// HRMS → Appraisal schedule — HR only, and only your team unless your access role may see everyone
// (performanceScope). The list says who is appraised on which form, so viewing it is logged.
appraisalSchedulesRouter.get('/appraisal-schedules', authMiddleware, requireModule(MODULES.HR), logSensitiveAccess('APPRAISALS'), asyncHandler(getAppraisalSchedules));
appraisalSchedulesRouter.get('/appraisal-schedules/created', authMiddleware, requireModule(MODULES.HR), logSensitiveAccess('APPRAISALS'), asyncHandler(getCreatedAppraisals));
// Staff you may schedule or observe (your team, or everyone) — names and positions only, for the pickers.
appraisalSchedulesRouter.get('/performance/staff', authMiddleware, requireModule(MODULES.HR), asyncHandler(getPerformanceStaff));
appraisalSchedulesRouter.post('/appraisal-schedules', authMiddleware, requireModule(MODULES.HR), asyncHandler(createAppraisalSchedules));
appraisalSchedulesRouter.delete('/appraisal-schedules/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteAppraisalSchedule));
appraisalSchedulesRouter.post('/appraisal-schedules/:id/create-now', authMiddleware, requireModule(MODULES.HR), asyncHandler(createAppraisalNow));
// HRMS → Appraisals → New appraisal: one for someone now, without a schedule.
appraisalSchedulesRouter.post('/appraisals/start', authMiddleware, requireModule(MODULES.HR), asyncHandler(startAppraisalOneOff));
