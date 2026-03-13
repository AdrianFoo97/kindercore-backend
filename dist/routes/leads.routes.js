"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsRouter = void 0;
const express_1 = require("express");
const leads_controller_js_1 = require("../controllers/leads.controller.js");
const auth_middleware_js_1 = require("../middlewares/auth.middleware.js");
exports.leadsRouter = (0, express_1.Router)();
exports.leadsRouter.post('/', leads_controller_js_1.createLead);
exports.leadsRouter.get('/', auth_middleware_js_1.authMiddleware, leads_controller_js_1.getLeads);
exports.leadsRouter.get('/stats', auth_middleware_js_1.authMiddleware, leads_controller_js_1.getLeadStats);
exports.leadsRouter.get('/analytics', auth_middleware_js_1.authMiddleware, leads_controller_js_1.getAnalytics);
exports.leadsRouter.get('/sales-analytics', auth_middleware_js_1.authMiddleware, leads_controller_js_1.getSalesAnalytics);
exports.leadsRouter.patch('/:id', auth_middleware_js_1.authMiddleware, leads_controller_js_1.updateLead);
exports.leadsRouter.post('/:id/appointment', auth_middleware_js_1.authMiddleware, leads_controller_js_1.createAppointment);
exports.leadsRouter.get('/upcoming', auth_middleware_js_1.authMiddleware, leads_controller_js_1.getUpcomingAppointments);
//# sourceMappingURL=leads.routes.js.map