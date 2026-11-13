import { Router } from 'express';
import { addFavorite, listMyFavorites, removeFavorite } from '../controllers/sop-favorites.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopFavoritesRouter = Router();

// Your own favourite guides — anyone who can open Guides (the Operation module).
// The handlers only ever touch the signed-in person's own favourites.
sopFavoritesRouter.get('/sop-favorites', authMiddleware, requireModule(MODULES.OPERATION), asyncHandler(listMyFavorites));
sopFavoritesRouter.put('/sop-favorites/:sopTemplateId', authMiddleware, requireModule(MODULES.OPERATION), asyncHandler(addFavorite));
sopFavoritesRouter.delete('/sop-favorites/:sopTemplateId', authMiddleware, requireModule(MODULES.OPERATION), asyncHandler(removeFavorite));
