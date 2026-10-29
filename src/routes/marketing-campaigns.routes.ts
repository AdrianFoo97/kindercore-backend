import { Router } from 'express';
import {
  listMarketingCampaigns, createMarketingCampaign, updateMarketingCampaign, deleteMarketingCampaign, checkPromoCode,
} from '../controllers/marketing-campaigns.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const marketingCampaignsRouter = Router();

// Public — the enquiry form's live-validation check, no login.
marketingCampaignsRouter.get('/marketing-campaigns/check', asyncHandler(checkPromoCode));

marketingCampaignsRouter.get('/marketing-campaigns', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(listMarketingCampaigns));
marketingCampaignsRouter.post('/marketing-campaigns', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(createMarketingCampaign));
marketingCampaignsRouter.patch('/marketing-campaigns/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(updateMarketingCampaign));
marketingCampaignsRouter.delete('/marketing-campaigns/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(deleteMarketingCampaign));
