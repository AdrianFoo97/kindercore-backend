import { Router } from 'express';
import {
  listObservations, getObservation, createObservation, advanceStage, saveStepResultsDraft,
} from '../controllers/sop-observations.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopObservationsRouter = Router();

sopObservationsRouter.get('/sop-observations', authMiddleware, requireModule(MODULES.HR), asyncHandler(listObservations));
sopObservationsRouter.post('/sop-observations', authMiddleware, requireModule(MODULES.HR), asyncHandler(createObservation));
sopObservationsRouter.get('/sop-observations/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(getObservation));
sopObservationsRouter.post('/sop-observations/:id/advance', authMiddleware, requireModule(MODULES.HR), asyncHandler(advanceStage));
sopObservationsRouter.post('/sop-observations/:id/step-results', authMiddleware, requireModule(MODULES.HR), asyncHandler(saveStepResultsDraft));
