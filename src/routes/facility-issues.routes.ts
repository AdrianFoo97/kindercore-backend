import { Router } from 'express';
import {
  createFacilityIssue, getFacilityAttachment, listFacilityIssues, listMyFacilityIssues, updateFacilityIssueStatus,
} from '../controllers/facility-issues.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { facilityAttachmentsUpload } from '../services/facilityAttachments.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const facilityIssuesRouter = Router();

// Two levels, like Incidents:
//  - any staff member reports an issue (with photos / videos) and sees the
//    ones they reported;
//  - facility managers (OPERATION_FACILITY_MANAGE view, granted per role in
//    Admin → Views; Admins always) see every issue and move its status.
// Attachments are checked in the handler: reporter, managers or Admins.
facilityIssuesRouter.post('/facility-issues', authMiddleware, facilityAttachmentsUpload, asyncHandler(createFacilityIssue));
facilityIssuesRouter.get('/facility-issues/mine', authMiddleware, asyncHandler(listMyFacilityIssues));
facilityIssuesRouter.get('/facility-issues/:id/attachments/:fileId', authMiddleware, asyncHandler(getFacilityAttachment));
facilityIssuesRouter.get('/facility-issues', authMiddleware, requireView('OPERATION_FACILITY_MANAGE'), asyncHandler(listFacilityIssues));
facilityIssuesRouter.patch('/facility-issues/:id/status', authMiddleware, requireView('OPERATION_FACILITY_MANAGE'), asyncHandler(updateFacilityIssueStatus));
