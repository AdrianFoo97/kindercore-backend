"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const auth_routes_js_1 = require("./auth.routes.js");
const leads_routes_js_1 = require("./leads.routes.js");
const google_routes_js_1 = require("./google.routes.js");
const settings_routes_js_1 = require("./settings.routes.js");
const packages_routes_js_1 = require("./packages.routes.js");
const students_routes_js_1 = require("./students.routes.js");
exports.router = (0, express_1.Router)();
exports.router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
exports.router.use('/auth', auth_routes_js_1.authRouter);
exports.router.use('/leads', leads_routes_js_1.leadsRouter);
exports.router.use('/google', google_routes_js_1.googleRouter);
exports.router.use('/settings', settings_routes_js_1.settingsRouter);
exports.router.use('/packages', packages_routes_js_1.packagesRouter);
exports.router.use('/students', students_routes_js_1.studentsRouter);
//# sourceMappingURL=index.js.map