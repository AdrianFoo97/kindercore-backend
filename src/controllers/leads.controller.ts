import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { google } from 'googleapis';
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { RowDataPacket } from 'mysql2';
import { db, pool } from '../db/client.js';
import { googleConnections, leads, systemSettings } from '../db/schema.js';
import { createLeadSchema, updateLeadSchema } from '../validators/lead.validator.js';

export async function createLead(req: Request, res: Response): Promise<void> {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const { childName, parentPhone, childDob, enrolmentYear, company,
          relationship, programme, preferredAppointmentTime, addressLocation,
          needsTransport, howDidYouKnow, submittedAt: submittedAtRaw } = parsed.data;
  if (company) {
    res.status(400).json({ message: 'Bad request' });
    return;
  }

  console.log('[Lead] New submission received:', JSON.stringify(parsed.data, null, 2));

  const id = randomUUID();
  const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : new Date();
  await db.insert(leads).values({
    id, childName, parentPhone, childDob: new Date(childDob), enrolmentYear,
    relationship, programme, preferredAppointmentTime, addressLocation,
    needsTransport, howDidYouKnow, submittedAt,
  });
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  res.status(201).json(lead);
}

export async function resetAllLeads(_req: Request, res: Response): Promise<void> {
  await db.delete(leads);
  res.json({ message: 'All leads deleted' });
}

export async function getLeadPhones(_req: Request, res: Response): Promise<void> {
  const rows = await db.select({ id: leads.id, parentPhone: leads.parentPhone, childName: leads.childName, submittedAt: leads.submittedAt }).from(leads);
  res.json(rows);
}

export async function getLeads(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? '20') || 20));
  const skip = (page - 1) * pageSize;

  const { status, sortBy, sortOrder } = req.query as Record<string, string | undefined>;

  const validSortFields = ['submittedAt', 'childName', 'childDob', 'enrolmentYear', 'status'];
  const field = validSortFields.includes(sortBy ?? '') ? sortBy! : 'submittedAt';
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';
  const sortByStatus = field === 'status';

  // Auto-advance past appointments to FOLLOW_UP
  await db.update(leads)
    .set({ status: 'FOLLOW_UP' })
    .where(and(eq(leads.status, 'APPOINTMENT_BOOKED'), sql`${leads.appointmentStart} < NOW()`));

  // Build WHERE clause string for count + raw queries
  let whereStr: string;
  const whereParams: any[] = [];
  if (status === 'active') {
    whereStr = "status NOT IN ('ENROLLED', 'LOST')";
  } else if (status === 'inactive') {
    whereStr = "status IN ('ENROLLED', 'LOST')";
  } else if (status) {
    whereStr = 'status = ?';
    whereParams.push(status);
  } else {
    whereStr = '1=1';
  }

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM \`Lead\` WHERE ${whereStr}`,
    whereParams,
  ) as any;
  const total = Number((countRow as any).total);

  const needsRawQuery = sortByStatus || status === 'active';
  let items: unknown[];

  if (needsRawQuery) {
    const statusCase = `CASE status
      WHEN 'NEW' THEN 1
      WHEN 'CONTACTED' THEN 2
      WHEN 'APPOINTMENT_BOOKED' THEN 3
      WHEN 'FOLLOW_UP' THEN 4
      WHEN 'ENROLLED' THEN 5
      WHEN 'LOST' THEN 6
      ELSE 7
    END`;
    const fieldSqlMap: Record<string, string> = {
      submittedAt: '`submittedAt`',
      childName: '`childName`',
      childDob: '`childDob`',
      enrolmentYear: '`enrolmentYear`',
    };
    const dirStr = order === 'asc' ? 'ASC' : 'DESC';
    const fieldStr = fieldSqlMap[field] ?? '`submittedAt`';

    let orderByStr: string;
    if (sortByStatus) {
      orderByStr = `${statusCase} ${dirStr}, \`submittedAt\` DESC`;
    } else {
      orderByStr = `${statusCase} ASC, ${fieldStr} ${dirStr}`;
    }

    const query = `SELECT * FROM \`Lead\` WHERE ${whereStr} ORDER BY ${orderByStr} LIMIT ${pageSize} OFFSET ${skip}`;
    const [rows] = await pool.query<RowDataPacket[]>(query, whereParams) as any;
    items = rows as unknown[];
  } else {
    // Drizzle builder for simple cases
    const drizzleWhere =
      status === 'inactive' ? inArray(leads.status, ['ENROLLED', 'LOST']) :
      status ? eq(leads.status, status as any) :
      undefined;

    const sortCol =
      field === 'childName' ? leads.childName :
      field === 'childDob' ? leads.childDob :
      field === 'enrolmentYear' ? leads.enrolmentYear :
      leads.submittedAt;

    items = await db.select().from(leads)
      .where(drizzleWhere)
      .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
      .limit(pageSize)
      .offset(skip);
  }

  res.json({ items, total, page, pageSize });
}

export async function getLeadStats(_req: Request, res: Response): Promise<void> {
  const groups = await db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.status);

  const counts: Record<string, number> = {};
  for (const g of groups) counts[g.status] = Number(g.count);

  res.json({
    NEW: counts['NEW'] ?? 0,
    CONTACTED: counts['CONTACTED'] ?? 0,
    APPOINTMENT_BOOKED: counts['APPOINTMENT_BOOKED'] ?? 0,
    FOLLOW_UP: counts['FOLLOW_UP'] ?? 0,
    ENROLLED: counts['ENROLLED'] ?? 0,
    LOST: counts['LOST'] ?? 0,
  });
}

export async function updateLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }

  const { childDob, ...rest } = parsed.data;
  await db.update(leads).set({
    ...rest,
    ...(childDob ? { childDob: new Date(childDob) } : {}),
  } as any).where(eq(leads.id, id));

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  res.json(lead);
}

function roundUpTo30Min(date: Date): Date {
  const result = new Date(date);
  const minutes = result.getMinutes();
  const remainder = minutes % 30;
  if (remainder === 0) return result;
  result.setMinutes(minutes + (30 - remainder), 0, 0);
  return result;
}

export async function createAppointment(
  req: Request,
  res: Response,
  next: import('express').NextFunction,
): Promise<void> {
  try {
    await _createAppointment(req, res);
  } catch (err) {
    next(err);
  }
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) return cleaned.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '60' + cleaned.slice(1);
  return '60' + cleaned;
}

function buildEventDescription(
  lead: { parentPhone: string; childDob: Date; enrolmentYear: number; submittedAt: Date },
  whatsappMessage?: string,
): string {
  const lines = [
    `Parent Phone: ${lead.parentPhone}`,
    `Date of Birth: ${lead.childDob.toISOString().split('T')[0]}`,
    `Enrolment Year: ${lead.enrolmentYear}`,
    `Submitted: ${lead.submittedAt.toISOString()}`,
  ];
  if (whatsappMessage) {
    const waLink = `https://web.whatsapp.com/send?phone=${normalizePhone(lead.parentPhone)}`;
    lines.push(`\nWhatsApp: ${waLink}`);
  }
  return lines.join('\n');
}

async function _createAppointment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { appointmentStart: appointmentStartStr, whatsappMessage, isPlaceholder } = req.body as {
    appointmentStart?: string; whatsappMessage?: string; isPlaceholder?: boolean;
  };

  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) {
    res.status(409).json({ message: 'Google calendar not connected' });
    return;
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) {
    res.status(404).json({ message: 'Lead not found' });
    return;
  }

  const start = appointmentStartStr
    ? new Date(appointmentStartStr)
    : roundUpTo30Min(new Date(Date.now() + 2 * 60 * 60 * 1000));

  const [durationSetting] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'appointment_duration_minutes'))
    .limit(1);
  const durationMs = (Number(durationSetting?.value) || 30) * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: Number(connection.expiryDate),
  });

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await db.update(googleConnections).set({
        accessToken: tokens.access_token,
        updatedAt: new Date(),
        ...(tokens.expiry_date != null ? { expiryDate: BigInt(tokens.expiry_date) } : {}),
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  if (lead.googleEventId) {
    try {
      await calendar.events.delete({
        calendarId: process.env.SHARED_CALENDAR_ID!,
        eventId: lead.googleEventId,
      });
    } catch {
      // Ignore — event may have already been deleted manually
    }
  }

  const event = await calendar.events.insert({
    calendarId: process.env.SHARED_CALENDAR_ID!,
    requestBody: {
      summary: `${isPlaceholder ? '【PH】' : ''}School Visit - ${lead.childName}`,
      description: buildEventDescription(lead, whatsappMessage),
      location: process.env.KINDER_ADDRESS ?? '',
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
    },
  });

  await db.update(leads).set({
    googleEventId: event.data.id,
    googleEventLink: event.data.htmlLink,
    appointmentStart: start,
    appointmentEnd: end,
    appointmentCreatedByUserId: req.user!.id,
    appointmentIsPlaceholder: !!isPlaceholder,
    status: isPlaceholder ? 'CONTACTED' : 'APPOINTMENT_BOOKED',
  }).where(eq(leads.id, id));

  res.json({ googleEventId: event.data.id, googleEventLink: event.data.htmlLink });
}

export async function getUpcomingAppointments(_req: Request, res: Response): Promise<void> {
  const now = new Date();
  const items = await db
    .select({
      id: leads.id,
      childName: leads.childName,
      parentPhone: leads.parentPhone,
      appointmentStart: leads.appointmentStart,
      appointmentEnd: leads.appointmentEnd,
      appointmentIsPlaceholder: leads.appointmentIsPlaceholder,
    })
    .from(leads)
    .where(gte(leads.appointmentStart, now))
    .orderBy(asc(leads.appointmentStart));
  res.json(items);
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function getAnalytics(req: Request, res: Response): Promise<void> {
  const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
  const prevYear = selectedYear - 1;

  const dateRange = (y: number) => and(
    gte(leads.submittedAt, new Date(y, 0, 1)),
    lt(leads.submittedAt, new Date(y + 1, 0, 1)),
  );

  const [currentLeads, prevLeads] = await Promise.all([
    db.select({
      submittedAt: leads.submittedAt,
      childDob: leads.childDob,
      appointmentStart: leads.appointmentStart,
      addressLocation: leads.addressLocation,
      howDidYouKnow: leads.howDidYouKnow,
      status: leads.status,
      lostReason: leads.lostReason,
    }).from(leads).where(dateRange(selectedYear)),
    db.select({ submittedAt: leads.submittedAt }).from(leads).where(dateRange(prevYear)),
  ]);

  const totalLeads = currentLeads.length;
  const totalAppointments = currentLeads.filter(l => l.appointmentStart !== null).length;
  const completedLeads = currentLeads.filter(l => l.status === 'ENROLLED' || l.status === 'LOST');
  // "Didn't attend" — covers both system-tracked ("Didn't attend the enquiry") and imported ("Didn't attend")
  const noShowLeads = completedLeads.filter(l =>
    l.status === 'LOST' && l.lostReason != null && l.lostReason.toLowerCase().includes("didn't attend")
  ).length;
  // Attended = all completed leads minus no-shows (works for imported data without appointmentStart)
  const attendedAppointments = completedLeads.length - noShowLeads;
  const appointmentRate = completedLeads.length > 0 ? attendedAppointments / completedLeads.length : 0;

  const currentMonthly = new Array(12).fill(0);
  for (const l of currentLeads) currentMonthly[l.submittedAt.getMonth()]++;
  const prevMonthly = new Array(12).fill(0);
  for (const l of prevLeads) prevMonthly[l.submittedAt.getMonth()]++;
  const monthlyComparison = MONTH_LABELS.map((label, i) => ({
    month: label, current: currentMonthly[i], previous: prevMonthly[i],
  }));

  const monthMap = new Map<string, Record<string, number>>();
  for (const lead of currentLeads) {
    const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
    const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
    const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
    const ageKey = age >= 2 && age <= 7 ? String(age) : 'other';
    if (!monthMap.has(monthLabel)) monthMap.set(monthLabel, {});
    const m = monthMap.get(monthLabel)!;
    m[ageKey] = (m[ageKey] ?? 0) + 1;
  }
  const monthlyByAge = MONTH_LABELS
    .filter(label => monthMap.has(label))
    .map(label => {
      const ages = monthMap.get(label)!;
      return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });

  const addressMap = new Map<string, number>();
  for (const lead of currentLeads) {
    if (lead.addressLocation) addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
  }
  const addressBreakdown = Array.from(addressMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);

  const channelMap = new Map<string, number>();
  for (const lead of currentLeads) {
    if (lead.howDidYouKnow) channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
  }
  const marketingChannelBreakdown = Array.from(channelMap.entries())
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  const leadsDetail = currentLeads.map(l => ({
    monthIdx: l.submittedAt.getMonth(),
    address: l.addressLocation ?? null,
    channel: l.howDidYouKnow ?? null,
  }));

  const [yearRows] = await pool.query<RowDataPacket[]>(
    'SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC',
  ) as any;
  const availableYears = (yearRows as any[]).map((r: any) => Number(r.year));

  res.json({
    selectedYear, prevYear,
    totalLeads, totalAppointments, completedLeads: completedLeads.length,
    attendedAppointments, noShowLeads, appointmentRate,
    monthlyComparison, monthlyByAge,
    addressBreakdown, marketingChannelBreakdown,
    leadsDetail, availableYears,
  });
}

export async function getSalesAnalytics(req: Request, res: Response): Promise<void> {
  const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
  const prevYear = selectedYear - 1;

  const closedWhere = (year: number) => and(
    gte(leads.submittedAt, new Date(`${year}-01-01T00:00:00.000Z`)),
    lt(leads.submittedAt, new Date(`${year + 1}-01-01T00:00:00.000Z`)),
    or(
      eq(leads.status, 'ENROLLED'),
      and(eq(leads.status, 'LOST'), ne(leads.lostReason as any, "Didn't attend the enquiry")),
    ),
  );

  const [closedLeads, prevLeads] = await Promise.all([
    db.select({
      id: leads.id, childName: leads.childName, notes: leads.notes, lostReason: leads.lostReason,
      addressLocation: leads.addressLocation, howDidYouKnow: leads.howDidYouKnow,
      childDob: leads.childDob, submittedAt: leads.submittedAt, status: leads.status, enrolmentYear: leads.enrolmentYear,
    }).from(leads).where(closedWhere(selectedYear)).orderBy(asc(leads.submittedAt)),
    db.select({ submittedAt: leads.submittedAt, status: leads.status }).from(leads).where(closedWhere(prevYear)),
  ]);

  const totalLeads = closedLeads.length;
  const enrolledLeads = closedLeads.filter(l => l.status === 'ENROLLED').length;
  const lostLeads = closedLeads.filter(l => l.status === 'LOST').length;
  const closingRate = totalLeads > 0 ? enrolledLeads / totalLeads : 0;

  const enrolledMonthly = new Array(12).fill(0);
  const lostMonthly = new Array(12).fill(0);
  for (const l of closedLeads) {
    const m = l.submittedAt.getMonth();
    if (l.status === 'ENROLLED') enrolledMonthly[m]++;
    else if (l.status === 'LOST') lostMonthly[m]++;
  }
  const prevMonthly = new Array(12).fill(0);
  for (const l of prevLeads) {
    if (l.status === 'ENROLLED') prevMonthly[l.submittedAt.getMonth()]++;
  }
  const monthlyComparison = MONTH_LABELS.map((label, i) => ({
    month: label, enrolled: enrolledMonthly[i], lost: lostMonthly[i], previous: prevMonthly[i],
  }));

  const monthMap = new Map<string, Record<string, number>>();
  for (const lead of closedLeads) {
    const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
    const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
    const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
    const ageKey = age >= 2 && age <= 7 ? String(age) : 'other';
    if (!monthMap.has(monthLabel)) monthMap.set(monthLabel, {});
    const m = monthMap.get(monthLabel)!;
    m[ageKey] = (m[ageKey] ?? 0) + 1;
  }
  const monthlyByAge = MONTH_LABELS
    .filter(l => monthMap.has(l))
    .map(label => {
      const ages = monthMap.get(label)!;
      return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });

  const addressMap = new Map<string, number>();
  const channelMap = new Map<string, number>();
  for (const lead of closedLeads) {
    if (lead.addressLocation) addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
    if (lead.howDidYouKnow) channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
  }
  const addressBreakdown = Array.from(addressMap.entries()).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
  const marketingChannelBreakdown = Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);

  const leadsTable = closedLeads.map(lead => {
    const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
    return {
      id: lead.id,
      childName: lead.childName,
      status: lead.status,
      enrolmentYear: lead.enrolmentYear,
      notes: lead.notes ?? lead.lostReason ?? null,
      addressLocation: lead.addressLocation,
      howDidYouKnow: lead.howDidYouKnow,
      age: Math.floor(ageMs / (365.25 * 24 * 3600 * 1000)),
      submittedAt: lead.submittedAt,
    };
  });

  const [yearRows] = await pool.query<RowDataPacket[]>(
    'SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC',
  ) as any;
  const availableYears = (yearRows as any[]).map((r: any) => Number(r.year));

  res.json({
    selectedYear, prevYear, totalLeads, enrolledLeads, lostLeads, closingRate,
    monthlyComparison, monthlyByAge, addressBreakdown, marketingChannelBreakdown,
    leadsTable, availableYears,
  });
}

export { roundUpTo30Min };
