import { Router } from 'express';
import {
  listRevisions, getRevision, createRevision, updateRevision, approveRevision, rejectRevision,
  returnRevision, resubmitRevision, startTrial,
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
// Try it in practice before deciding — a review action like approve/reject.
sopRevisionsRouter.post('/sop-revisions/:id/trial', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(startTrial));
// Send back to the proposer with feedback — a review action like approve/reject.
sopRevisionsRouter.post('/sop-revisions/:id/return', authMiddleware, requireView('OPERATION_SOP_APPROVE'), asyncHandler(returnRevision));
// The proposer's own changes after a send-back — the handler only lets the person who sent it resubmit.
sopRevisionsRouter.post('/sop-revisions/:id/resubmit', authMiddleware, asyncHandler(resubmitRevision));
