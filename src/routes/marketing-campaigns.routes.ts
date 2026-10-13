import { Router } from 'express';
import {
  listMarketingCampaigns, createMarketingCampaign, updateMarketingCampaign, deleteMarketingCampaign, checkPromoCode,
} from '../controllers/marketing-campaigns.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const marketingCampaignsRouter = Router();

// Public — the enquiry form's live-validation check, no login.
marketingCampaignsRouter.get('/marketing-campaigns/check', asyncHandler(checkPromoCode));

marketingCampaignsRouter.get('/marketing-campaigns', authMiddleware, asyncHandler(listMarketingCampaigns));
marketingCampaignsRouter.post('/marketing-campaigns', authMiddleware, asyncHandler(createMarketingCampaign));
marketingCampaignsRouter.patch('/marketing-campaigns/:id', authMiddleware, asyncHandler(updateMarketingCampaign));
marketingCampaignsRouter.delete('/marketing-campaigns/:id', authMiddleware, asyncHandler(deleteMarketingCampaign));
