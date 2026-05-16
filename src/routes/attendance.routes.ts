import { Router } from 'express';
import { scanRfid, getStudentAttendance, deleteAttendance } from '../controllers/attendance.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const attendanceRouter = Router();

// Mounted at the root (/) so the per-student listing keeps its natural
// `/students/:id/attendance` shape alongside the global `/attendance/*`
// endpoints used by the physical reader and admins.

// Public — physical RFID readers don't carry user JWTs. The scan
// controller validates by looking up the card in the Student table; an
// unknown card returns 404. If you need a hardware-key in front of this,
// add a header check here (e.g. X-Reader-Key) before reaching the handler.
attendanceRouter.post('/attendance/scan', asyncHandler(scanRfid));

// Authenticated — admin views + manual deletions.
attendanceRouter.get('/students/:id/attendance', authMiddleware, asyncHandler(getStudentAttendance));
attendanceRouter.delete('/attendance/:attendanceId', authMiddleware, asyncHandler(deleteAttendance));
