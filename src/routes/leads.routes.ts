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
  confirmAppointmentWithoutCalendar,
  getUpcomingAppointments,
  resetAllLeads,
  seedDummyLeads,
} from '../controllers/leads.controller.js';
import { setLeadLabels } from '../controllers/lead-labels.controller.js';
import { authMiddleware, adminMiddleware, requireModule, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leadsRouter = Router();

leadsRouter.post('/', asyncHandler(createLead));
leadsRouter.get('/phones', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(getLeadPhones));
leadsRouter.get('/', authMiddleware, requireAnyModule(MODULES.MARKETING, MODULES.ANALYSIS), asyncHandler(getLeads));
leadsRouter.get('/stats', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(getLeadStats));
leadsRouter.get('/analytics', authMiddleware, requireAnyModule(MODULES.MARKETING, MODULES.ANALYSIS), asyncHandler(getAnalytics));
leadsRouter.get('/sales-analytics', authMiddleware, requireAnyModule(MODULES.MARKETING, MODULES.ANALYSIS), asyncHandler(getSalesAnalytics));
leadsRouter.delete('/reset', authMiddleware, adminMiddleware, asyncHandler(resetAllLeads));
leadsRouter.post('/seed-dummy', authMiddleware, adminMiddleware, asyncHandler(seedDummyLeads));
leadsRouter.get('/upcoming', authMiddleware, requireAnyModule(MODULES.MARKETING, MODULES.HR), asyncHandler(getUpcomingAppointments));
leadsRouter.get('/trash', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(getTrashedLeads));
leadsRouter.get('/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(getLeadById));
leadsRouter.patch('/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(updateLead));
leadsRouter.put('/:id/labels', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(setLeadLabels));
leadsRouter.delete('/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(deleteLead));
leadsRouter.post('/:id/restore', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(restoreLead));
leadsRouter.delete('/:id/permanent', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(permanentDeleteLead));
leadsRouter.post('/:id/appointment', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(createAppointment));
leadsRouter.post('/:id/confirm-appointment', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(confirmAppointment));
leadsRouter.post('/:id/confirm-appointment-no-calendar', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(confirmAppointmentWithoutCalendar));
