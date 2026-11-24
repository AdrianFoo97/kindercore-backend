import { Router } from 'express';
import {
  listMissions, createMission, updateMission, deleteMission, reorderMissions,
  getTeacherCareer, upsertTeacherMissionProgress, setMissionTarget, bulkUpdateMissions,
} from '../controllers/career-missions.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { wholeSchoolHr, selfOrTeam } from '../middlewares/teamAccess.middleware.js';
import { aiRequestLimit } from '../middlewares/aiLimit.middleware.js';
import { applyMissionImportHandler, getMissionTemplate, missionFileUpload, readMissionImport } from '../controllers/missionImport.controller.js';

export const careerMissionsRouter = Router();

careerMissionsRouter.get('/career-missions', authMiddleware, asyncHandler(listMissions));
careerMissionsRouter.post('/career-missions', authMiddleware, wholeSchoolHr(), asyncHandler(createMission));
careerMissionsRouter.patch('/career-missions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateMission));
careerMissionsRouter.delete('/career-missions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteMission));
careerMissionsRouter.post('/career-missions/reorder', authMiddleware, wholeSchoolHr(), asyncHandler(reorderMissions));
// Import with AI: read an Excel/PDF list into a preview (saves nothing), then create what the person kept.
// Several missions at once (archive, or set difficulty / required / priority / category).
careerMissionsRouter.post('/career-missions/bulk', authMiddleware, wholeSchoolHr(), asyncHandler(bulkUpdateMissions));
careerMissionsRouter.get('/career-missions/import/template', authMiddleware, wholeSchoolHr(), asyncHandler(getMissionTemplate));
careerMissionsRouter.post('/career-missions/import/read', authMiddleware, wholeSchoolHr(), aiRequestLimit, missionFileUpload, asyncHandler(readMissionImport));
careerMissionsRouter.post('/career-missions/import/apply', authMiddleware, wholeSchoolHr(), asyncHandler(applyMissionImportHandler));

careerMissionsRouter.get('/teachers/:teacherId/career-page', authMiddleware, selfOrTeam(), asyncHandler(getTeacherCareer));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/progress', authMiddleware, selfOrTeam(), asyncHandler(upsertTeacherMissionProgress));
careerMissionsRouter.put('/teachers/:teacherId/missions/:missionId/target', authMiddleware, selfOrTeam(), asyncHandler(setMissionTarget));
