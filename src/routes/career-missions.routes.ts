import { Router } from 'express';
import {
  listMissions, createMission, updateMission, deleteMission, reorderMissions,
  getTeacherCareer, upsertTeacherMissionProgress, setMissionTarget,
} from '../controllers/career-missions.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const careerMissionsRouter = Router();

careerMissionsRouter.get('/career-missions', authMiddleware, asyncHandler(listMissions));
careerMissionsRouter.post('/career-missions', authMiddleware, asyncHandler(createMission));
careerMissionsRouter.patch('/career-missions/:id', authMiddleware, asyncHandler(updateMission));
careerMissionsRouter.delete('/career-missions/:id', authMiddleware, asyncHandler(deleteMission));
careerMissionsRouter.post('/career-missions/reorder', authMiddleware, asyncHandler(reorderMissions));

careerMissionsRouter.get('/teachers/:teacherId/career-page', authMiddleware, asyncHandler(getTeacherCareer));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/progress', authMiddleware, asyncHandler(upsertTeacherMissionProgress));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/target', authMiddleware, asyncHandler(setMissionTarget));
