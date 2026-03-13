"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const auth_controller_js_1 = require("../controllers/auth.controller.js");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/login', auth_controller_js_1.login);
//# sourceMappingURL=auth.routes.js.map