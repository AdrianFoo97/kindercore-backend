import { Router } from 'express';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, reorderTemplates, setTemplateCategories,
} from '../controllers/sop-templates.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { aiRequestLimit } from '../middlewares/aiLimit.middleware.js';
import { acceptPoster, discardPoster, drawPoster, getPosterAiStatus, getPosterImage } from '../controllers/guidePoster.controller.js';

export const sopTemplatesRouter = Router();

// Anyone authenticated can read the library — direct create/edit/delete/
// reorder requires the OPERATION_SOP_APPROVE view (granted to an AuthRole
// like "Supervisor"; ADMIN/SUPERADMIN always bypass). Everyone else goes
// through the propose-then-approve flow instead (see sop-revisions.routes.ts).
sopTemplatesRouter.get('/sop-templates', authMiddleware, asyncHandler(listTemplates));
// AI poster — drawn once on request by guide authors, then shown to everyone.
sopTemplatesRouter.get('/sop-templates/poster/ai-status', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(getPosterAiStatus));
sopTemplatesRouter.post('/sop-templates/:id/poster/draft', authMiddleware, requireView('OPERATION_SOP_APPROVE'), aiRequestLimit, asyncHandler(drawPoster));
sopTemplatesRouter.post('/sop-templates/:id/poster/accept', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(acceptPoster));
sopTemplatesRouter.delete('/sop-templates/:id/poster/draft', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(discardPoster));
sopTemplatesRouter.get('/sop-templates/:id/poster/image/:imageId', authMiddleware, asyncHandler(getPosterImage));
sopTemplatesRouter.post('/sop-templates', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(createTemplate));
sopTemplatesRouter.patch('/sop-templates/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(updateTemplate));
sopTemplatesRouter.delete('/sop-templates/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(deleteTemplate));
sopTemplatesRouter.post('/sop-templates/reorder', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(reorderTemplates));
sopTemplatesRouter.put('/sop-templates/:id/categories', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(setTemplateCategories));
