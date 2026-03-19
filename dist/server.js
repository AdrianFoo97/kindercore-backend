"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const index_js_1 = require("./routes/index.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 4000;
const isProd = process.env.NODE_ENV === 'production';
// ── Security headers ──
app.use((0, helmet_1.default)());
// ── CORS ──
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
}));
// ── Body size limit ──
app.use(express_1.default.json({ limit: '1mb' }));
// ── Rate limiting ──
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 login attempts per 15 min per IP
    message: { message: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
const leadCreateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 enquiries per hour per IP
    message: { message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/leads', (req, _res, next) => {
    if (req.method === 'POST' && req.path === '/')
        return leadCreateLimiter(req, _res, next);
    next();
});
// ── Request logging ──
app.use((req, res, next) => {
    const start = Date.now();
    const { method, originalUrl } = req;
    res.on('finish', () => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[REQ]';
        console.log(`${prefix} ${method} ${originalUrl} ${status} ${ms}ms`);
    });
    next();
});
// ── Routes ──
app.use('/api', index_js_1.router);
// ── Global error handler ──
app.use((err, req, res, _next) => {
    const timestamp = new Date().toISOString();
    const { method, originalUrl, ip } = req;
    // Detect database connection errors
    const isDbError = /ECONNREFUSED|ETIMEDOUT|ER_ACCESS_DENIED|PROTOCOL_CONNECTION_LOST|ER_BAD_DB_ERROR|ENOTFOUND|connect ECONN/i.test(err.message);
    if (isDbError) {
        console.error(`[ERROR] ${timestamp} DB_UNAVAILABLE | ${method} ${originalUrl} | IP: ${ip} | ${err.message}`);
        res.status(503).json({ message: 'Service temporarily unavailable. Please try again shortly.', code: 'DB_UNAVAILABLE' });
        return;
    }
    // Log full stack for 500 errors
    console.error(`[ERROR] ${timestamp} INTERNAL_ERROR | ${method} ${originalUrl} | IP: ${ip}`);
    console.error(err.stack ?? err.message);
    res.status(500).json({ message: isProd ? 'Something went wrong. Please try again.' : err.message, code: 'INTERNAL_ERROR' });
});
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[backend] Server running on http://localhost:${PORT}`);
    const dbUrl = process.env.DATABASE_URL ?? '(not set)';
    const masked = dbUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`[backend] DATABASE_URL: ${masked}`);
});
//# sourceMappingURL=server.js.map