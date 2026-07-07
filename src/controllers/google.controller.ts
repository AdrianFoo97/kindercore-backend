import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { googleConnections, systemSettings } from '../db/schema.js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) {
    res.json({ connected: false, email: null, calendarName: null, calendarId: null, interviewCalendarId: null, interviewCalendarName: null });
    return;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: Number(connection.expiryDate),
  });

  // Verify the token is still valid by forcing a refresh
  try {
    await oauth2Client.getAccessToken();
  } catch (err: any) {
    const msg = String(err?.response?.data?.error ?? err?.message ?? '');
    if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
      res.json({ connected: false, email: null, calendarName: null, calendarId: null, interviewCalendarId: null, interviewCalendarName: null });
      return;
    }
  }

  const strip = (raw: string | null | undefined) => raw ? String(raw).replace(/^"|"$/g, '') : null;

  const [calSetting, ivCalSetting] = await Promise.all([
    db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1).then(r => r[0]),
  ]);
  const calendarId = strip(calSetting?.value as string | undefined) ?? 'primary';
  const interviewCalendarId = strip(ivCalSetting?.value as string | undefined); // null → falls back to calendarId

  try {
    const cal = google.calendar({ version: 'v3', auth: oauth2Client });
    const [userInfoResult, calendarResult, interviewCalResult] = await Promise.allSettled([
      google.oauth2({ version: 'v2', auth: oauth2Client }).userinfo.get(),
      cal.calendars.get({ calendarId }),
      interviewCalendarId ? cal.calendars.get({ calendarId: interviewCalendarId }) : Promise.resolve(null),
    ]);

    const email = userInfoResult.status === 'fulfilled' ? (userInfoResult.value.data.email ?? null) : null;
    const calendarName = calendarResult.status === 'fulfilled' ? (calendarResult.value.data.summary ?? null) : null;
    const interviewCalendarName = interviewCalResult.status === 'fulfilled' && interviewCalResult.value
      ? (interviewCalResult.value.data.summary ?? null) : null;

    res.json({ connected: true, email, calendarName, calendarId, interviewCalendarId, interviewCalendarName });
  } catch {
    res.json({ connected: true, email: null, calendarName: null, calendarId, interviewCalendarId, interviewCalendarName: null });
  }
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
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'],
    state,
  });
  res.redirect(authUrl);
}

export async function listCalendars(_req: Request, res: Response): Promise<void> {
  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) { res.status(409).json({ message: 'Google Calendar not connected' }); return; }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: Number(connection.expiryDate),
  });

  try {
    const { data } = await google.calendar({ version: 'v3', auth: oauth2Client }).calendarList.list({ maxResults: 100 });
    const calendars = (data.items ?? []).map(c => ({ id: c.id, name: c.summary, primary: c.primary ?? false }));
    res.json(calendars);
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error';
    const status = err?.response?.status ?? 500;
    console.log('[Google] listCalendars failed:', JSON.stringify(err?.response?.data ?? err?.message));
    res.status(status).json({ message: msg });
  }
}

export async function setCalendar(req: Request, res: Response): Promise<void> {
  const { calendarId } = req.body as { calendarId: string };
  if (!calendarId) { res.status(400).json({ message: 'calendarId required' }); return; }

  const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1);
  const now = new Date();
  if (existing) {
    await db.update(systemSettings).set({ value: calendarId, updatedAt: now }).where(eq(systemSettings.key, 'shared_calendar_id'));
  } else {
    await db.insert(systemSettings).values({ id: randomUUID(), key: 'shared_calendar_id', value: calendarId, updatedAt: now });
  }
  res.json({ calendarId });
}

// Separate setting for candidate interviews so admins can route them to
// a different calendar (e.g. HR-only) from the general appointments feed.
// An empty string clears the setting → interviews fall back to shared_calendar_id.
export async function setInterviewCalendar(req: Request, res: Response): Promise<void> {
  const { calendarId } = req.body as { calendarId: string };
  const now = new Date();
  const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1);
  if (!calendarId) {
    if (existing) {
      await db.delete(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id'));
    }
    res.json({ calendarId: null });
    return;
  }
  if (existing) {
    await db.update(systemSettings).set({ value: calendarId, updatedAt: now }).where(eq(systemSettings.key, 'interview_calendar_id'));
  } else {
    await db.insert(systemSettings).values({ id: randomUUID(), key: 'interview_calendar_id', value: calendarId, updatedAt: now });
  }
  res.json({ calendarId });
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

  // Auto-select calendar containing "principal" if no calendar is set yet
  const [calSetting] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1);
  if (!calSetting) {
    try {
      oauth2Client.setCredentials(tokens);
      const { data } = await google.calendar({ version: 'v3', auth: oauth2Client }).calendarList.list({ maxResults: 100 });
      const principalCal = (data.items ?? []).find(c => c.summary?.toLowerCase().includes('principal'));
      const selectedId = principalCal?.id ?? (data.items ?? []).find(c => c.primary)?.id ?? 'primary';
      await db.insert(systemSettings).values({ id: randomUUID(), key: 'shared_calendar_id', value: selectedId, updatedAt: new Date() });
    } catch (err) {
      console.log('[Google] Auto-select calendar failed:', err);
    }
  }

  res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/settings/calendar?google=connected`);
}
