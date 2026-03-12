import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client.js';
function getOAuth2Client() {
    return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}
export async function getStatus(_req, res) {
    const connection = await prisma.googleConnection.findFirst();
    res.json({ connected: !!connection });
}
export async function connectToken(req, res) {
    const state = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const protocol = req.protocol;
    const host = req.get('host') ?? `localhost:${process.env.PORT ?? 4000}`;
    const url = `${protocol}://${host}/api/google/auth?state=${encodeURIComponent(state)}`;
    res.json({ url });
}
export function startAuth(req, res) {
    const { state } = req.query;
    try {
        jwt.verify(state, process.env.JWT_SECRET);
    }
    catch {
        res.status(400).json({ message: 'Invalid or expired state' });
        return;
    }
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar.events'],
        state,
    });
    res.redirect(authUrl);
}
export async function handleCallback(req, res) {
    const { code, state } = req.query;
    try {
        jwt.verify(state, process.env.JWT_SECRET);
    }
    catch {
        res.status(400).send('Invalid or expired state');
        return;
    }
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const existing = await prisma.googleConnection.findFirst();
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? '';
    await prisma.googleConnection.deleteMany();
    await prisma.googleConnection.create({
        data: {
            accessToken: tokens.access_token,
            refreshToken,
            expiryDate: BigInt(tokens.expiry_date ?? 0),
            scope: tokens.scope ?? 'https://www.googleapis.com/auth/calendar.events',
        },
    });
    res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/login?google=connected`);
}
//# sourceMappingURL=google.controller.js.map