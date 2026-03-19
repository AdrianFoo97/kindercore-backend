"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
exports.connectToken = connectToken;
exports.startAuth = startAuth;
exports.handleCallback = handleCallback;
const crypto_1 = require("crypto");
const googleapis_1 = require("googleapis");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_js_1 = require("../db/client.js");
const schema_js_1 = require("../db/schema.js");
function getOAuth2Client() {
    return new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}
async function getStatus(_req, res) {
    const [connection] = await client_js_1.db.select().from(schema_js_1.googleConnections).limit(1);
    if (!connection) {
        res.json({ connected: false, email: null, calendarName: null, calendarId: null });
        return;
    }
    try {
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
            expiry_date: Number(connection.expiryDate),
        });
        const calendarId = process.env.SHARED_CALENDAR_ID ?? 'primary';
        const [userInfoResult, calendarResult] = await Promise.allSettled([
            googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client }).userinfo.get(),
            googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client }).calendars.get({ calendarId }),
        ]);
        const email = userInfoResult.status === 'fulfilled' ? (userInfoResult.value.data.email ?? null) : null;
        const calendarName = calendarResult.status === 'fulfilled' ? (calendarResult.value.data.summary ?? null) : null;
        res.json({ connected: true, email, calendarName, calendarId });
    }
    catch {
        res.json({ connected: true, email: null, calendarName: null, calendarId: process.env.SHARED_CALENDAR_ID ?? null });
    }
}
async function connectToken(req, res) {
    const state = jsonwebtoken_1.default.sign({ userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const protocol = req.protocol;
    const host = req.get('host') ?? `localhost:${process.env.PORT ?? 4000}`;
    const url = `${protocol}://${host}/api/google/auth?state=${encodeURIComponent(state)}`;
    res.json({ url });
}
function startAuth(req, res) {
    const { state } = req.query;
    try {
        jsonwebtoken_1.default.verify(state, process.env.JWT_SECRET);
    }
    catch {
        res.status(400).json({ message: 'Invalid or expired state' });
        return;
    }
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'],
        state,
    });
    res.redirect(authUrl);
}
async function handleCallback(req, res) {
    const { code, state } = req.query;
    try {
        jsonwebtoken_1.default.verify(state, process.env.JWT_SECRET);
    }
    catch {
        res.status(400).send('Invalid or expired state');
        return;
    }
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const [existing] = await client_js_1.db.select().from(schema_js_1.googleConnections).limit(1);
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? '';
    const now = new Date();
    await client_js_1.db.delete(schema_js_1.googleConnections);
    await client_js_1.db.insert(schema_js_1.googleConnections).values({
        id: (0, crypto_1.randomUUID)(),
        accessToken: tokens.access_token,
        refreshToken,
        expiryDate: BigInt(tokens.expiry_date ?? 0),
        scope: tokens.scope ?? 'https://www.googleapis.com/auth/calendar.events',
        createdAt: now,
        updatedAt: now,
    });
    res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/settings/calendar?google=connected`);
}
//# sourceMappingURL=google.controller.js.map