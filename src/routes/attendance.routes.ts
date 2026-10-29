import { Router } from 'express';
import { scanRfid, getStudentAttendance, deleteAttendance } from '../controllers/attendance.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { readerOrStaffMiddleware } from '../middlewares/reader.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const attendanceRouter = Router();

// Mounted at the root (/) so the per-student listing keeps its natural
// `/students/:id/attendance` shape alongside the global `/attendance/*`
// endpoints used by the physical reader and admins.

// Physical RFID readers don't carry user JWTs, so they authenticate with a
// shared X-Reader-Key instead; signed-in staff (the app's manual scan) use
// their normal login. See reader.middleware.ts — enforced once
// ATTENDANCE_READER_KEY is set on the server.
attendanceRouter.post('/attendance/scan', readerOrStaffMiddleware, asyncHandler(scanRfid));

// Authenticated — admin views + manual deletions.
attendanceRouter.get('/students/:id/attendance', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(getStudentAttendance));
attendanceRouter.delete('/attendance/:attendanceId', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(deleteAttendance));
