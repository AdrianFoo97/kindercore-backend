import { Router } from 'express';
import {
  listAuthViews, createAuthView, updateAuthView, deleteAuthView,
} from '../controllers/auth-views.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authViewsRouter = Router();

// Admin-only end to end — unlike auth-roles' read side, nothing non-admin
// needs the raw views catalog today.
authViewsRouter.get('/auth-views', authMiddleware, adminMiddleware, asyncHandler(listAuthViews));
authViewsRouter.post('/auth-views', authMiddleware, adminMiddleware, asyncHandler(createAuthView));
authViewsRouter.patch('/auth-views/:id', authMiddleware, adminMiddleware, asyncHandler(updateAuthView));
authViewsRouter.delete('/auth-views/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAuthView));
