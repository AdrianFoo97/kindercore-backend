import { Router } from 'express';
import {
  getStatus,
  connectToken,
  startAuth,
  handleCallback,
  listCalendars,
  setCalendar,
  setInterviewCalendar,
} from '../controllers/google.controller.js';
import { authMiddleware, requireModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const googleRouter = Router();

googleRouter.get('/status', authMiddleware, adminMiddleware, asyncHandler(getStatus));
googleRouter.post('/connect-token', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(connectToken));
googleRouter.get('/calendars', authMiddleware, adminMiddleware, asyncHandler(listCalendars));
googleRouter.patch('/calendar', authMiddleware, adminMiddleware, asyncHandler(setCalendar));
googleRouter.patch('/interview-calendar', authMiddleware, adminMiddleware, asyncHandler(setInterviewCalendar));
googleRouter.get('/auth', startAuth);
googleRouter.get('/callback', asyncHandler(handleCallback));
