import { Router } from 'express';
import {
  listObservations, getObservation, createObservation, advanceStage, saveStepResultsDraft, getTeacherTraining, recordTrainingGiven, sendBackForTraining, saveObservationMarking,
} from '../controllers/sop-observations.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { selfOrTeam, wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const sopObservationsRouter = Router();

sopObservationsRouter.get('/sop-observations', authMiddleware, requireModule(MODULES.HR), asyncHandler(listObservations));
sopObservationsRouter.post('/sop-observations', authMiddleware, requireModule(MODULES.HR), asyncHandler(createObservation));
sopObservationsRouter.get('/sop-observations/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(getObservation));
sopObservationsRouter.post('/sop-observations/:id/advance', authMiddleware, requireModule(MODULES.HR), asyncHandler(advanceStage));
// The assessor sends it back to the trainer when a step failed.
sopObservationsRouter.post('/sop-observations/:id/send-back', authMiddleware, requireModule(MODULES.HR), asyncHandler(sendBackForTraining));
sopObservationsRouter.post('/sop-observations/:id/step-results', authMiddleware, requireModule(MODULES.HR), asyncHandler(saveStepResultsDraft));
// Teacher app → My training: their SOP observations as trainee and as trainer (their own, or HR).
sopObservationsRouter.get('/teachers/:teacherId/training', authMiddleware, selfOrTeam(), asyncHandler(getTeacherTraining));
// Teacher app → My training → Trainer: the assigned trainer records the day they gave the training (or HR for them).
sopObservationsRouter.post('/teachers/:teacherId/training/:observationId/trained', authMiddleware, selfOrTeam(), asyncHandler(recordTrainingGiven));
// Settings → Practice observations: how new observations mark their steps (admins).
sopObservationsRouter.put('/sop-observation-marking', authMiddleware, wholeSchoolHr(), asyncHandler(saveObservationMarking));
