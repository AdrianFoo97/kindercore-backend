import { Router } from 'express';
import {
  listMissions, createMission, updateMission, deleteMission, reorderMissions,
  getTeacherCareer, upsertTeacherMissionProgress, setMissionTarget,
} from '../controllers/career-missions.controller.js';
import { authMiddleware, selfOrModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const careerMissionsRouter = Router();

careerMissionsRouter.get('/career-missions', authMiddleware, asyncHandler(listMissions));
careerMissionsRouter.post('/career-missions', authMiddleware, adminMiddleware, asyncHandler(createMission));
careerMissionsRouter.patch('/career-missions/:id', authMiddleware, adminMiddleware, asyncHandler(updateMission));
careerMissionsRouter.delete('/career-missions/:id', authMiddleware, adminMiddleware, asyncHandler(deleteMission));
careerMissionsRouter.post('/career-missions/reorder', authMiddleware, adminMiddleware, asyncHandler(reorderMissions));

careerMissionsRouter.get('/teachers/:teacherId/career-page', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getTeacherCareer));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/progress', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(upsertTeacherMissionProgress));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/target', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(setMissionTarget));
