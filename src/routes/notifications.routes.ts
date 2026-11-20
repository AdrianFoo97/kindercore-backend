import { Router } from 'express';
import {
  getNotificationSettings, listMyNotifications, readAllNotifications, readNotification, saveNotificationSettings,
} from '../controllers/notifications.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// The bell: each person's own notifications (scoped to the caller in the service).
export const notificationsRouter = Router();

notificationsRouter.get('/notifications', authMiddleware, asyncHandler(listMyNotifications));
notificationsRouter.get('/notifications/settings', authMiddleware, asyncHandler(getNotificationSettings));
notificationsRouter.put('/notifications/settings', authMiddleware, asyncHandler(saveNotificationSettings));
notificationsRouter.post('/notifications/read-all', authMiddleware, asyncHandler(readAllNotifications));
notificationsRouter.post('/notifications/:id/read', authMiddleware, asyncHandler(readNotification));
