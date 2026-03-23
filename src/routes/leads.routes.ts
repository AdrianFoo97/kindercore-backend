import { Router } from 'express';
import {
  createLead,
  getLeadById,
  getLeads,
  getLeadPhones,
  getLeadStats,
  getAnalytics,
  getSalesAnalytics,
  updateLead,
  deleteLead,
  getTrashedLeads,
  restoreLead,
  permanentDeleteLead,
  createAppointment,
  confirmAppointment,
  getUpcomingAppointments,
  resetAllLeads,
  seedDummyLeads,
} from '../controllers/leads.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leadsRouter = Router();

leadsRouter.post('/', asyncHandler(createLead));
leadsRouter.get('/phones', authMiddleware, asyncHandler(getLeadPhones));
leadsRouter.get('/', authMiddleware, asyncHandler(getLeads));
leadsRouter.get('/stats', authMiddleware, asyncHandler(getLeadStats));
leadsRouter.get('/analytics', authMiddleware, asyncHandler(getAnalytics));
leadsRouter.get('/sales-analytics', authMiddleware, asyncHandler(getSalesAnalytics));
leadsRouter.delete('/reset', authMiddleware, adminMiddleware, asyncHandler(resetAllLeads));
leadsRouter.post('/seed-dummy', authMiddleware, adminMiddleware, asyncHandler(seedDummyLeads));
leadsRouter.get('/upcoming', authMiddleware, asyncHandler(getUpcomingAppointments));
leadsRouter.get('/trash', authMiddleware, asyncHandler(getTrashedLeads));
leadsRouter.get('/:id', authMiddleware, asyncHandler(getLeadById));
leadsRouter.patch('/:id', authMiddleware, asyncHandler(updateLead));
leadsRouter.delete('/:id', authMiddleware, asyncHandler(deleteLead));
leadsRouter.post('/:id/restore', authMiddleware, asyncHandler(restoreLead));
leadsRouter.delete('/:id/permanent', authMiddleware, asyncHandler(permanentDeleteLead));
leadsRouter.post('/:id/appointment', authMiddleware, asyncHandler(createAppointment));
leadsRouter.post('/:id/confirm-appointment', authMiddleware, asyncHandler(confirmAppointment));
