import { Router } from 'express';
import {
  listSections, createSection, updateSection, deleteSection, reorderSections,
} from '../controllers/sop-sections.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopSectionsRouter = Router();

// Anyone authenticated can read the section list (used when picking a
// step's section) — managing the taxonomy itself is admin-only.
sopSectionsRouter.get('/sop-sections', authMiddleware, asyncHandler(listSections));
sopSectionsRouter.post('/sop-sections', authMiddleware, adminMiddleware, asyncHandler(createSection));
sopSectionsRouter.patch('/sop-sections/:id', authMiddleware, adminMiddleware, asyncHandler(updateSection));
sopSectionsRouter.delete('/sop-sections/:id', authMiddleware, adminMiddleware, asyncHandler(deleteSection));
sopSectionsRouter.post('/sop-sections/reorder', authMiddleware, adminMiddleware, asyncHandler(reorderSections));
