import { Router } from 'express';
import {
  listRevisions, getRevision, createRevision, updateRevision, approveRevision, rejectRevision,
} from '../controllers/sop-revisions.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sopRevisionsRouter = Router();

// Any authenticated user (teacher or admin) can propose a change or a new
// SOP — only the review actions require the OPERATION_SOP_APPROVE view
// (granted to an AuthRole like "Supervisor"; ADMIN/SUPERADMIN always bypass).
sopRevisionsRouter.get('/sop-revisions', authMiddleware, asyncHandler(listRevisions));
sopRevisionsRouter.get('/sop-revisions/:id', authMiddleware, asyncHandler(getRevision));
sopRevisionsRouter.post('/sop-revisions', authMiddleware, asyncHandler(createRevision));
// A reviewer refining a proposal's content before approving is part of the
// review action, same permission bar as approve/reject.
sopRevisionsRouter.patch('/sop-revisions/:id', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(updateRevision));
sopRevisionsRouter.post('/sop-revisions/:id/approve', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(approveRevision));
sopRevisionsRouter.post('/sop-revisions/:id/reject', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(rejectRevision));
