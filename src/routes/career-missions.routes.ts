import { Router } from 'express';
import {
  listMissions, createMission, updateMission, deleteMission, reorderMissions,
  getTeacherCareer, upsertTeacherMissionProgress, setMissionTarget,
} from '../controllers/career-missions.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr, selfOrTeam } from '../middlewares/teamAccess.middleware.js';

export const careerMissionsRouter = Router();

careerMissionsRouter.get('/career-missions', authMiddleware, asyncHandler(listMissions));
careerMissionsRouter.post('/career-missions', authMiddleware, wholeSchoolHr(), asyncHandler(createMission));
careerMissionsRouter.patch('/career-missions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateMission));
careerMissionsRouter.delete('/career-missions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteMission));
careerMissionsRouter.post('/career-missions/reorder', authMiddleware, wholeSchoolHr(), asyncHandler(reorderMissions));

careerMissionsRouter.get('/teachers/:teacherId/career-page', authMiddleware, selfOrTeam(), asyncHandler(getTeacherCareer));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/progress', authMiddleware, selfOrTeam(), asyncHandler(upsertTeacherMissionProgress));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/target', authMiddleware, selfOrTeam(), asyncHandler(setMissionTarget));
