import { Router } from 'express';
import { createLead, getLeads, getLeadStats, getAnalytics, getSalesAnalytics, updateLead, createAppointment, getUpcomingAppointments, } from '../controllers/leads.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
export const leadsRouter = Router();
leadsRouter.post('/', createLead);
leadsRouter.get('/', authMiddleware, getLeads);
leadsRouter.get('/stats', authMiddleware, getLeadStats);
leadsRouter.get('/analytics', authMiddleware, getAnalytics);
leadsRouter.get('/sales-analytics', authMiddleware, getSalesAnalytics);
leadsRouter.patch('/:id', authMiddleware, updateLead);
leadsRouter.post('/:id/appointment', authMiddleware, createAppointment);
leadsRouter.get('/upcoming', authMiddleware, getUpcomingAppointments);
//# sourceMappingURL=leads.routes.js.map