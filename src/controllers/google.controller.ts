import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { db } from '../db/client.js';
import { googleConnections } from '../db/schema.js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const [connection] = await db.select().from(googleConnections).limit(1);
  res.json({ connected: !!connection });
}

export async function connectToken(req: Request, res: Response): Promise<void> {
  const state = jwt.sign(
    { userId: req.user!.id },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  );
  const protocol = req.protocol;
  const host = req.get('host') ?? `localhost:${process.env.PORT ?? 4000}`;
  const url = `${protocol}://${host}/api/google/auth?state=${encodeURIComponent(state)}`;
  res.json({ url });
}

export function startAuth(req: Request, res: Response): void {
  const { state } = req.query as { state: string };
  try {
    jwt.verify(state, process.env.JWT_SECRET!);
  } catch {
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

export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as { code: string; state: string };

  try {
    jwt.verify(state, process.env.JWT_SECRET!);
  } catch {
    res.status(400).send('Invalid or expired state');
    return;
  }

  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  const [existing] = await db.select().from(googleConnections).limit(1);
  const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? '';

  const now = new Date();
  await db.delete(googleConnections);
  await db.insert(googleConnections).values({
    id: randomUUID(),
    accessToken: tokens.access_token!,
    refreshToken,
    expiryDate: BigInt(tokens.expiry_date ?? 0),
    scope: tokens.scope ?? 'https://www.googleapis.com/auth/calendar.events',
    createdAt: now,
    updatedAt: now,
  });

  res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/login?google=connected`);
}
