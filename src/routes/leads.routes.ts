import { Router } from 'express';
import {
  createLead,
  getLeads,
  getLeadStats,
  getAnalytics,
  getSalesAnalytics,
  updateLead,
  createAppointment,
  getUpcomingAppointments,
} from '../controllers/leads.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leadsRouter = Router();

leadsRouter.post('/', asyncHandler(createLead));
leadsRouter.get('/', authMiddleware, asyncHandler(getLeads));
leadsRouter.get('/stats', authMiddleware, asyncHandler(getLeadStats));
leadsRouter.get('/analytics', authMiddleware, asyncHandler(getAnalytics));
leadsRouter.get('/sales-analytics', authMiddleware, asyncHandler(getSalesAnalytics));
leadsRouter.patch('/:id', authMiddleware, asyncHandler(updateLead));
leadsRouter.post('/:id/appointment', authMiddleware, createAppointment);
leadsRouter.get('/upcoming', authMiddleware, asyncHandler(getUpcomingAppointments));
