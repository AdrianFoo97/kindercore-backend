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
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const plannerRouter = Router();

// Teachers
plannerRouter.get('/teachers', authMiddleware, asyncHandler(getTeachers));
plannerRouter.post('/teachers', authMiddleware, asyncHandler(createTeacher));
plannerRouter.put('/teachers/:id', authMiddleware, asyncHandler(updateTeacher));
plannerRouter.delete('/teachers/:id', authMiddleware, asyncHandler(deleteTeacher));

// Classrooms
plannerRouter.get('/classrooms', authMiddleware, asyncHandler(getClassrooms));
plannerRouter.post('/classrooms', authMiddleware, asyncHandler(createClassroom));
plannerRouter.put('/classrooms/:id', authMiddleware, asyncHandler(updateClassroom));
plannerRouter.delete('/classrooms/:id', authMiddleware, asyncHandler(deleteClassroom));

// Subjects
plannerRouter.get('/subjects', authMiddleware, asyncHandler(getSubjects));
plannerRouter.post('/subjects', authMiddleware, asyncHandler(createSubject));
plannerRouter.put('/subjects/:id', authMiddleware, asyncHandler(updateSubject));
plannerRouter.delete('/subjects/:id', authMiddleware, asyncHandler(deleteSubject));

// Tasks
plannerRouter.get('/tasks', authMiddleware, asyncHandler(getTasks));
plannerRouter.post('/tasks', authMiddleware, asyncHandler(createTask));
plannerRouter.put('/tasks/:id', authMiddleware, asyncHandler(updateTask));
plannerRouter.delete('/tasks/:id', authMiddleware, asyncHandler(deleteTask));

// Schedule Blocks
plannerRouter.get('/blocks', authMiddleware, asyncHandler(getBlocks));
plannerRouter.post('/blocks', authMiddleware, asyncHandler(createBlock));
plannerRouter.put('/blocks/:id', authMiddleware, asyncHandler(updateBlock));
plannerRouter.delete('/blocks/:id', authMiddleware, asyncHandler(deleteBlock));
plannerRouter.post('/blocks/duplicate', authMiddleware, asyncHandler(duplicateBlock));
plannerRouter.post('/blocks/copy-week', authMiddleware, asyncHandler(copyWeek));
plannerRouter.post('/blocks/check-conflicts', authMiddleware, asyncHandler(checkConflicts));

// Saved Timetables
plannerRouter.get('/timetables', authMiddleware, asyncHandler(getSavedTimetables));
plannerRouter.post('/timetables', authMiddleware, asyncHandler(saveTimetable));
plannerRouter.post('/timetables/:id/load', authMiddleware, asyncHandler(loadTimetable));
plannerRouter.delete('/timetables/:id', authMiddleware, asyncHandler(deleteSavedTimetable));
