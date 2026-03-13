"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packagesRouter = void 0;
const express_1 = require("express");
const packages_controller_js_1 = require("../controllers/packages.controller.js");
const auth_middleware_js_1 = require("../middlewares/auth.middleware.js");
exports.packagesRouter = (0, express_1.Router)();
exports.packagesRouter.get('/', auth_middleware_js_1.authMiddleware, packages_controller_js_1.getPackages);
exports.packagesRouter.post('/', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.createPackage);
exports.packagesRouter.put('/', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.upsertPackages);
exports.packagesRouter.get('/years', auth_middleware_js_1.authMiddleware, packages_controller_js_1.getPackageYears);
exports.packagesRouter.get('/config', auth_middleware_js_1.authMiddleware, packages_controller_js_1.getPackagesConfig);
exports.packagesRouter.put('/programmes', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.updateProgrammes);
exports.packagesRouter.put('/ages', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.updateAges);
exports.packagesRouter.delete('/:id', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.deletePackage);
exports.packagesRouter.patch('/:id/name', auth_middleware_js_1.authMiddleware, auth_middleware_js_1.adminMiddleware, packages_controller_js_1.patchPackageName);
//# sourceMappingURL=packages.routes.js.map