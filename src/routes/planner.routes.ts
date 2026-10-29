import { Router } from 'express';
import {
  getTeachers, createTeacher, updateTeacher, deleteTeacher,
  getClassrooms, createClassroom, updateClassroom, deleteClassroom,
  getSubjects, createSubject, updateSubject, deleteSubject,
  getTasks, createTask, updateTask, deleteTask,
  getBlocks, createBlock, updateBlock, deleteBlock,
  duplicateBlock, copyWeek, checkConflicts,
  getSavedTimetables, saveTimetable, loadTimetable, deleteSavedTimetable,
} from '../controllers/planner.controller.js';
import { authMiddleware, requireModule, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const plannerRouter = Router();

// Teachers
plannerRouter.get('/teachers', authMiddleware, asyncHandler(getTeachers));
plannerRouter.post('/teachers', authMiddleware, requireModule(MODULES.HR), asyncHandler(createTeacher));
plannerRouter.put('/teachers/:id', authMiddleware, requireAnyModule(MODULES.HR, MODULES.TOOLS), asyncHandler(updateTeacher));
plannerRouter.delete('/teachers/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteTeacher));

// Classrooms
plannerRouter.get('/classrooms', authMiddleware, requireAnyModule(MODULES.TOOLS, MODULES.HR), asyncHandler(getClassrooms));
plannerRouter.post('/classrooms', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(createClassroom));
plannerRouter.put('/classrooms/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(updateClassroom));
plannerRouter.delete('/classrooms/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(deleteClassroom));

// Subjects
plannerRouter.get('/subjects', authMiddleware, requireAnyModule(MODULES.TOOLS, MODULES.HR), asyncHandler(getSubjects));
plannerRouter.post('/subjects', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(createSubject));
plannerRouter.put('/subjects/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(updateSubject));
plannerRouter.delete('/subjects/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(deleteSubject));

// Tasks
plannerRouter.get('/tasks', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(getTasks));
plannerRouter.post('/tasks', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(createTask));
plannerRouter.put('/tasks/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(updateTask));
plannerRouter.delete('/tasks/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(deleteTask));

// Schedule Blocks
plannerRouter.get('/blocks', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(getBlocks));
plannerRouter.post('/blocks', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(createBlock));
plannerRouter.put('/blocks/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(updateBlock));
plannerRouter.delete('/blocks/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(deleteBlock));
plannerRouter.post('/blocks/duplicate', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(duplicateBlock));
plannerRouter.post('/blocks/copy-week', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(copyWeek));
plannerRouter.post('/blocks/check-conflicts', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(checkConflicts));

// Saved Timetables
plannerRouter.get('/timetables', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(getSavedTimetables));
plannerRouter.post('/timetables', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(saveTimetable));
plannerRouter.post('/timetables/:id/load', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(loadTimetable));
plannerRouter.delete('/timetables/:id', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(deleteSavedTimetable));
