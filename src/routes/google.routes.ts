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
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const googleRouter = Router();

googleRouter.get('/status', authMiddleware, asyncHandler(getStatus));
googleRouter.post('/connect-token', authMiddleware, asyncHandler(connectToken));
googleRouter.get('/calendars', authMiddleware, asyncHandler(listCalendars));
googleRouter.patch('/calendar', authMiddleware, asyncHandler(setCalendar));
googleRouter.patch('/interview-calendar', authMiddleware, asyncHandler(setInterviewCalendar));
googleRouter.get('/auth', startAuth);
googleRouter.get('/callback', asyncHandler(handleCallback));
