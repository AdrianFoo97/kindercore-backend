"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsRouter = void 0;
const express_1 = require("express");
const settings_controller_js_1 = require("../controllers/settings.controller.js");
const auth_middleware_js_1 = require("../middlewares/auth.middleware.js");
const asyncHandler_js_1 = require("../utils/asyncHandler.js");
exports.settingsRouter = (0, express_1.Router)();
exports.settingsRouter.get('/', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(settings_controller_js_1.getSettings));
exports.settingsRouter.patch('/:key', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, (0, asyncHandler_js_1.asyncHandler)(settings_controller_js_1.updateSetting));
//# sourceMappingURL=settings.routes.js.map