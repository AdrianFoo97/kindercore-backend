import { Router } from 'express';
import {
  listObservations, getObservation, createObservation, advanceStage,
} from '../controllers/sop-observations.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopObservationsRouter = Router();

sopObservationsRouter.get('/sop-observations', authMiddleware, asyncHandler(listObservations));
sopObservationsRouter.post('/sop-observations', authMiddleware, asyncHandler(createObservation));
sopObservationsRouter.get('/sop-observations/:id', authMiddleware, asyncHandler(getObservation));
sopObservationsRouter.post('/sop-observations/:id/advance', authMiddleware, asyncHandler(advanceStage));
