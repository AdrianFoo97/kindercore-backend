"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.studentsRouter = void 0;
const express_1 = require("express");
const students_controller_js_1 = require("../controllers/students.controller.js");
const auth_middleware_js_1 = require("../middlewares/auth.middleware.js");
const asyncHandler_js_1 = require("../utils/asyncHandler.js");
exports.studentsRouter = (0, express_1.Router)();
exports.studentsRouter.get('/', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.getStudents));
exports.studentsRouter.post('/', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.createStudent));
exports.studentsRouter.put('/:id', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.updateStudent));
exports.studentsRouter.patch('/:id/onboarding', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.updateOnboardingProgress));
exports.studentsRouter.patch('/:id/complete-onboarding', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.completeOnboarding));
exports.studentsRouter.patch('/:id/withdraw', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.withdrawStudent));
exports.studentsRouter.patch('/:id/reactivate', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.reactivateStudent));
exports.studentsRouter.delete('/reset', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.resetAllStudents));
exports.studentsRouter.delete('/:id', auth_middleware_js_1.authMiddleware, (0, asyncHandler_js_1.asyncHandler)(students_controller_js_1.deleteStudent));
//# sourceMappingURL=students.routes.js.map