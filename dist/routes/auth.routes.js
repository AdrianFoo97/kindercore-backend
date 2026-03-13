"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const auth_controller_js_1 = require("../controllers/auth.controller.js");
const asyncHandler_js_1 = require("../utils/asyncHandler.js");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/login', (0, asyncHandler_js_1.asyncHandler)(auth_controller_js_1.login));
//# sourceMappingURL=auth.routes.js.map