"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleRouter = void 0;
const express_1 = require("express");
const google_controller_js_1 = require("../controllers/google.controller.js");
const auth_middleware_js_1 = require("../middlewares/auth.middleware.js");
const asyncHandler_js_1 = require("../utils/asyncHandler.js");
exports.googleRouter = (0, express_1.Router)();
exports.googleRouter.get('/status', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(google_controller_js_1.getStatus));
exports.googleRouter.post('/connect-token', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(google_controller_js_1.connectToken));
exports.googleRouter.get('/calendars', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(google_controller_js_1.listCalendars));
exports.googleRouter.patch('/calendar', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(google_controller_js_1.setCalendar));
exports.googleRouter.get('/auth', google_controller_js_1.startAuth);
exports.googleRouter.get('/callback', (0, asyncHandler_js_1.asyncHandler)(google_controller_js_1.handleCallback));
//# sourceMappingURL=google.routes.js.map