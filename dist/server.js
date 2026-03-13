"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const index_js_1 = require("./routes/index.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 4000;
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
}));
app.use(express_1.default.json());
app.use('/api', index_js_1.router);
// Global error handler — keeps the server alive on unhandled route errors
app.use((err, _req, res, _next) => {
    console.error('[error]', err.message);
    res.status(500).json({ message: err.message ?? 'Internal server error' });
});
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[backend] Server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=server.js.map