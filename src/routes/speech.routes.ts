import { Router } from 'express';
import { generateStudentSpeech, getStudentSpeech } from '../controllers/speech.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const speechRouter = Router();

// Admin-triggered generation — not exposed to hardware. The physical
// reader gets the resulting file's URL via the attendance scan response
// (see attendance.controller.ts) and fetches it through the public
// /uploads static mount.
speechRouter.post('/students/:id/speech', authMiddleware, adminMiddleware, asyncHandler(generateStudentSpeech));
speechRouter.get('/students/:id/speech', authMiddleware, asyncHandler(getStudentSpeech));
