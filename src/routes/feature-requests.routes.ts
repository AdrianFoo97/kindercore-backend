import { Router } from 'express';
import { createFeatureRequest, listFeatureRequests, reviewFeatureRequest } from '../controllers/feature-requests.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const featureRequestsRouter = Router();

// Anyone signed in can send an idea. Reading and reviewing them sits with the
// Tools module, next to Bug Reports (admins pass requireModule unconditionally).
featureRequestsRouter.post('/feature-requests', authMiddleware, asyncHandler(createFeatureRequest));
featureRequestsRouter.get('/feature-requests', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(listFeatureRequests));
featureRequestsRouter.post('/feature-requests/:id/review', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(reviewFeatureRequest));
