import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { and, asc, desc, eq, gte, isNull, like, or, sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { google } from 'googleapis';
import { candidates, googleConnections, systemSettings } from '../db/schema.js';
import { createCandidateSchema, updateCandidateSchema } from '../validators/candidate.validator.js';
import { PRIVATE_UPLOAD_ROOT } from '../routes/upload.routes.js';

// ── Resume security knobs ────────────────────────────────────────────────────
const RESUMES_DIR = path.join(PRIVATE_UPLOAD_ROOT, 'resumes');
fs.mkdirSync(RESUMES_DIR, { recursive: true });

/** Capitalises the first letter of every whitespace-separated block in
 *  a candidate's name. "adrian foo jun wei" → "Adrian Foo Jun Wei",
 *  "test" → "Test". Leaves already-capitalised chars alone so
 *  "McArthur" survives. Non-Latin scripts (CJK etc.) pass through
 *  unchanged. */
function titleCaseName(raw: string): string {
  return raw.split(/(\s+)/).map(seg => {
    if (!seg.trim()) return seg;
    const first = seg.charAt(0);
    const upper = first.toUpperCase();
    return upper === first ? seg : upper + seg.slice(1);
  }).join('');
}

/** Window after candidate creation during which the public upload route
 *  will accept a resume. Keeps the public endpoint from being usable as a
 *  general-purpose drop for any candidate id at any time. */
const RESUME_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const RESUME_MAX_BYTES = 10 * 1024 * 1024;

/** Verifies the file's first bytes match a PDF signature. Returns the
 *  extension (always '.pdf') when valid, or null if it should be rejected.
 *  MIME alone is forgeable; magic bytes are the real check. */
function checkResumeMagic(buf: Buffer, claimedMime: string): string | null {
  if (buf.length < 4) return null;
  if (claimedMime !== 'application/pdf') return null;
  // %PDF-
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
    ? '.pdf' : null;
}

const parseDate = (v: unknown): Date | undefined => {
  if (v == null || v === '') return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
};

// Defaults shown on the apply form when the admin hasn't set up the
// recruitment lists yet. Mirrored in the Settings UI placeholder.
// Positions carry an optional salary band the form shows below the
// dropdown when the candidate picks a role. Bands default to null so
// the admin can enter actual numbers in settings.
interface RecruitmentPosition {
  name: string;
  minSalary: number | null;
  maxSalary: number | null;
}
const DEFAULT_POSITIONS: RecruitmentPosition[] = [
  { name: 'Assistant Teacher',  minSalary: null, maxSalary: null },
  { name: 'Junior Teacher',     minSalary: null, maxSalary: null },
  { name: 'Senior Teacher',     minSalary: null, maxSalary: null },
  { name: 'Kindergarten Helper', minSalary: null, maxSalary: null },
];
const DEFAULT_QUALIFICATIONS = [
  'SPM / O Level',
  'Diploma / STPM / UEC / A Level',
  "Bachelor's degree",
  'Others',
];
const DEFAULT_EXPERIENCE_RANGES = [
  'No experience',
  'Less than 1 year',
  '1 – 2 years',
  '3 – 5 years',
  'More than 5 years',
];
const DEFAULT_REFERRAL_SOURCES = [
  'Transfer from other Ten Toes branch',
  'JobStreet',
  'Indeed',
  'Maukerja',
  'Facebook Group',
  'Facebook Ads',
  'MyFuture Job',
  'Other',
];

async function readStringArray(key: string, fallback: string[]): Promise<string[]> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (!row) return fallback;
  const raw = row.value;
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return fallback; }
  }
  if (!Array.isArray(arr)) return fallback;
  const clean = arr.map(x => String(x).trim()).filter(Boolean);
  return clean.length > 0 ? clean : fallback;
}

/** Reads `recruitment_positions` and normalises whatever shape is stored
 *  into `[{ name, minSalary, maxSalary }]`. Historic entries may be plain
 *  strings — we keep them working by promoting each string to an object
 *  with null bands. */
async function readPositionList(fallback: RecruitmentPosition[]): Promise<RecruitmentPosition[]> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'recruitment_positions')).limit(1);
  if (!row) return fallback;
  const raw = row.value;
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return fallback; }
  }
  if (!Array.isArray(arr)) return fallback;
  const clean: RecruitmentPosition[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (name) clean.push({ name, minSalary: null, maxSalary: null });
      continue;
    }
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      if (!name) continue;
      const min = typeof rec.minSalary === 'number' && rec.minSalary >= 0 ? rec.minSalary : null;
      const max = typeof rec.maxSalary === 'number' && rec.maxSalary >= 0 ? rec.maxSalary : null;
      clean.push({ name, minSalary: min, maxSalary: max });
    }
  }
  return clean.length > 0 ? clean : fallback;
}

/** Public — the apply form needs these to render its dropdowns without auth.
 *  Returns just the two whitelisted recruitment lists, never the full
 *  settings blob. */
export async function getCandidateFormOptions(_req: Request, res: Response): Promise<void> {
  const [positions, qualifications, experienceRanges, referralSources, addressSetting] = await Promise.all([
    readPositionList(DEFAULT_POSITIONS),
    readStringArray('recruitment_qualifications', DEFAULT_QUALIFICATIONS),
    readStringArray('recruitment_experience_ranges', DEFAULT_EXPERIENCE_RANGES),
    readStringArray('recruitment_referral_sources', DEFAULT_REFERRAL_SOURCES),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'kinder_address')).limit(1).then(r => r[0]),
  ]);
  // So the "Commute time to our school" question is answerable — applicants
  // otherwise have no idea where "our school" actually is.
  const address = (addressSetting?.value as string | undefined) ?? '';
  res.json({ positions, qualifications, experienceRanges, referralSources, address });
}

/** Public — anyone with the apply link can POST. No auth. */
export async function createCandidate(req: Request, res: Response): Promise<void> {
  const parsed = createCandidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  const id = randomUUID();
  const now = new Date();
  await db.insert(candidates).values({
    id,
    submittedAt: now,
    fullName: titleCaseName(data.fullName.trim()),
    phone: data.phone.trim(),
    dob: parseDate(data.dob) ?? null,
    addressLocation: data.addressLocation?.trim() || null,
    commuteTime: data.commuteTime ?? null,
    desiredPosition: data.desiredPosition?.trim() || null,
    expectedSalary: data.expectedSalary ?? null,
    expectedSalaryMax: data.expectedSalaryMax ?? null,
    availableFrom: parseDate(data.availableFrom) ?? null,
    preferredStartDate: parseDate(data.preferredStartDate) ?? null,
    experienceRange: data.experienceRange?.trim() || null,
    qualification: data.qualification?.trim() || null,
    qualificationOther: data.qualificationOther?.trim() || null,
    salaryJustification: data.salaryJustification.trim(),
    careerGoals: data.careerGoals.trim(),
    whyKindergartenTeacher: data.whyKindergartenTeacher.trim(),
    howDidYouKnow: data.howDidYouKnow?.trim() || null,
    notes: data.notes?.trim() || null,
    submissionSource: data.submissionSource ?? 'apply_form',
    utmSource: data.utmSource?.trim() || null,
    resumeUrl: data.resumeUrl?.trim() || null,
    status: 'NEW',
    statusChangedAt: now,
  });

  res.status(201).json({ id, ok: true });
}

/** Admin — bulk import a batch of candidates. Same validator as the
 *  public POST but skips the honeypot, applies to every row in the
 *  array, and returns per-row success/failure so the frontend import
 *  UI can show a clean report. Never partial-inserts a batch: each row
 *  is its own transaction so a bad row doesn't tank the good ones.
 *
 *  Body shape: `{ rows: CreateCandidateInput[] }`.
 *  Response: `{ inserted: N, failed: [{ index, error, row }] }`.
 *
 *  Deliberate defaults for imported rows:
 *  - `submissionSource` defaults to `'imported'` unless a row overrides.
 *  - Missing optional fields fall back to null / today's date sentinels
 *    (same as the create path) so legacy exports don't need to be
 *    scrubbed for every field. */
export async function importCandidates(req: Request, res: Response): Promise<void> {
  const { rows } = (req.body ?? {}) as { rows?: unknown[] };
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'Expected { rows: [...] }' });
    return;
  }
  if (rows.length === 0) {
    res.status(400).json({ error: 'No rows to import' });
    return;
  }
  if (rows.length > 500) {
    res.status(400).json({ error: 'Batch too large (max 500 rows per request)' });
    return;
  }

  const results: Array<{ index: number; id?: string; error?: string }> = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const parsed = createCandidateSchema.safeParse(rows[i]);
    if (!parsed.success) {
      results.push({
        index: i,
        error: JSON.stringify(parsed.error.flatten().fieldErrors),
      });
      continue;
    }
    const data = parsed.data;
    const id = randomUUID();
    const now = new Date();
    // Preserve the applicant's original submission timestamp when the
    // import row carries one — historical rows shouldn't all appear
    // "just submitted now". Unparseable values fall through to `now`.
    const submittedAt = (() => {
      if (!data.submittedAt) return now;
      const parsed = new Date(data.submittedAt);
      return isNaN(parsed.getTime()) ? now : parsed;
    })();
    try {
      await db.insert(candidates).values({
        id,
        submittedAt,
        fullName: titleCaseName(data.fullName.trim()),
        phone: data.phone.trim(),
        dob: parseDate(data.dob) ?? null,
        addressLocation: data.addressLocation?.trim() || null,
        commuteTime: data.commuteTime ?? null,
        desiredPosition: data.desiredPosition?.trim() || null,
        expectedSalary: data.expectedSalary ?? null,
    expectedSalaryMax: data.expectedSalaryMax ?? null,
        availableFrom: parseDate(data.availableFrom) ?? null,
        preferredStartDate: parseDate(data.preferredStartDate) ?? null,
        experienceRange: data.experienceRange?.trim() || null,
        qualification: data.qualification?.trim() || null,
        qualificationOther: data.qualificationOther?.trim() || null,
        salaryJustification: data.salaryJustification.trim(),
        careerGoals: data.careerGoals.trim(),
        whyKindergartenTeacher: data.whyKindergartenTeacher.trim(),
        howDidYouKnow: data.howDidYouKnow?.trim() || null,
        notes: data.notes?.trim() || null,
        submissionSource: data.submissionSource ?? 'imported',
        utmSource: data.utmSource?.trim() || null,
        resumeUrl: data.resumeUrl?.trim() || null,
        status: data.status ?? 'NEW',
        rejectionReason: data.rejectionReason?.trim() || null,
        hiredAt: data.status === 'HIRED' ? now : null,
        // Interview datetime preserved from the source sheet's
        // Appointment column. Unparseable value → null (row still
        // lands, just without a scheduled slot).
        interviewStart: (() => {
          if (!data.interviewStart) return null;
          const d = new Date(data.interviewStart);
          return isNaN(d.getTime()) ? null : d;
        })(),
        statusChangedAt: now,
      });
      inserted++;
      results.push({ index: i, id });
    } catch (err: any) {
      results.push({
        index: i,
        error: err?.message ?? 'Insert failed',
      });
    }
  }

  res.json({ inserted, total: rows.length, results });
}

/** Admin — nukes every candidate row. Intended for import iteration
 *  where the admin wants a clean slate between attempts. Hard delete,
 *  not soft: the whole point is to be able to re-import without
 *  duplicates or leftover soft-deleted rows cluttering the DB. Also
 *  cleans up the resume files those candidates pointed at so we
 *  don't leak disk. */
export async function resetAllCandidates(_req: Request, res: Response): Promise<void> {
  const all = await db.select().from(candidates);
  await db.delete(candidates);
  // Best-effort resume-file cleanup — a missing file isn't fatal.
  let filesRemoved = 0;
  for (const c of all) {
    if (!c.resumePath) continue;
    try {
      const abs = path.resolve(PRIVATE_UPLOAD_ROOT, c.resumePath);
      const rootWithSep = PRIVATE_UPLOAD_ROOT.endsWith(path.sep) ? PRIVATE_UPLOAD_ROOT : PRIVATE_UPLOAD_ROOT + path.sep;
      if (abs.startsWith(rootWithSep) && fs.existsSync(abs)) {
        fs.unlinkSync(abs);
        filesRemoved++;
      }
    } catch { /* ignore */ }
  }
  res.json({ deleted: all.length, filesRemoved });
}

export async function getCandidates(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1') || 1);
  // Cap generously — the admin list does its filtering / sorting
  // client-side over the whole dataset, so a fresh mass import (800+
  // rows) needs to arrive in one page. Guard the ceiling so a bad
  // caller can't ask for a million.
  const pageSize = Math.min(2000, Math.max(1, parseInt((req.query.pageSize as string) ?? '20') || 20));
  const skip = (page - 1) * pageSize;

  const { status, desiredPosition, search, sortBy, sortOrder } = req.query as Record<string, string | undefined>;
  const searchTerm = (search ?? '').trim();

  const validSortFields = ['submittedAt', 'fullName', 'status'];
  const field = validSortFields.includes(sortBy ?? '') ? sortBy! : 'submittedAt';
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';

  const notDeleted = isNull(candidates.deletedAt);
  const statusFilter =
    status === 'active' ? sql`status NOT IN ('HIRED','REJECTED','TALENT_BANK')` :
    status === 'closed' ? sql`status IN ('HIRED','REJECTED')` :
    status ? eq(candidates.status, status as any) :
    undefined;
  const positionFilter = desiredPosition ? eq(candidates.desiredPosition, desiredPosition) : undefined;
  // Phone matching needs to survive format drift — the same person may
  // land in the DB as `01161788443`, `+60 11-6178 8443`, or
  // `60 116178 8443` depending on how they typed it in the form. Strip
  // both the stored value and the query to digits-only, then LIKE.
  // Falls back to a raw phone LIKE only when the search term itself has
  // no digits (name-only searches).
  const searchDigits = searchTerm.replace(/\D/g, '');
  const searchFilter = searchTerm
    ? or(
        like(candidates.fullName, `%${searchTerm}%`),
        searchDigits
          ? sql`REGEXP_REPLACE(${candidates.phone}, '[^0-9]', '') LIKE ${'%' + searchDigits + '%'}`
          : like(candidates.phone, `%${searchTerm}%`),
      )
    : undefined;

  const whereExpr = and(notDeleted, statusFilter, positionFilter, searchFilter);

  const sortCol =
    field === 'fullName' ? candidates.fullName :
    field === 'status' ? candidates.status :
    candidates.submittedAt;

  const [items, totalRows] = await Promise.all([
    db.select().from(candidates)
      .where(whereExpr)
      .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
      .limit(pageSize)
      .offset(skip),
    db.select({ c: sql<number>`count(*)` }).from(candidates).where(whereExpr),
  ]);
  const total = Number(totalRows[0]?.c ?? 0);

  res.json({ items, total, page, pageSize });
}

export async function getCandidateStats(_req: Request, res: Response): Promise<void> {
  const groups = await db
    .select({ status: candidates.status, count: sql<number>`count(*)` })
    .from(candidates)
    .where(isNull(candidates.deletedAt))
    .groupBy(candidates.status);

  const counts: Record<string, number> = { NEW: 0, CONTACTED: 0, INTERVIEWING: 0, PENDING_DECISION: 0, OFFER_SENT: 0, HIRED: 0, REJECTED: 0, TALENT_BANK: 0 };
  for (const g of groups) counts[g.status] = Number(g.count);

  res.json({ counts });
}

// Phone index across ALL non-deleted candidates — used by the admin
// list to flag repeat applicants regardless of which tab the row lives
// on. Normalising the phone happens client-side (same canonical form
// used for search / dedup); this endpoint just streams the raw phone
// list so the client can build its Map<phoneKey, count>. Cheap enough
// on typical volumes (~15KB for 1000 rows).
export async function getCandidatePhoneIndex(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .select({ phone: candidates.phone })
    .from(candidates)
    .where(isNull(candidates.deletedAt));
  res.json(rows.map(r => r.phone).filter((p): p is string => !!p));
}

// Upcoming candidate interviews — used by:
//   1. The scheduling modal to detect clashes when the admin picks a slot.
//   2. The Candidates page context panel's "Interviews" tab.
// Only rows whose interview genuinely hasn't happened yet are returned:
// future interviewStart AND status in {CONTACTED, INTERVIEWING}. A row
// that's already at PENDING_DECISION / OFFER_SENT / HIRED / REJECTED
// has an old scheduled slot that's no longer meaningful (data drift
// from bulk imports where an interviewStart was date-only and status
// was advanced past interview).
export async function getUpcomingCandidateInterviews(_req: Request, res: Response): Promise<void> {
  // Anchor the "upcoming" cutoff at start-of-today, not "right now",
  // so today's interviews (including bulk-imported rows stamped at
  // 00:00) don't drop off the calendar as soon as their hour passes.
  // The Interview tab in the main list already relies on the row's
  // status; this endpoint is the calendar-of-scheduled feed.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      interviewStart: candidates.interviewStart,
      interviewEnd: candidates.interviewEnd,
    })
    .from(candidates)
    .where(and(
      gte(candidates.interviewStart, startOfToday),
      isNull(candidates.deletedAt),
      sql`status IN ('CONTACTED', 'INTERVIEWING')`,
    ))
    .orderBy(asc(candidates.interviewStart));
  res.json(rows);
}

// ── Interview scheduling + Google Calendar sync ───────────────────
// Wires the candidate's interviewStart/End (and the modal's admin-facing
// bookkeeping fields) into the shared Google Calendar the leads flow
// uses, so all HR events land in one place. `skipCalendar: true` writes
// only to the DB — the frontend uses this as a graceful fallback when
// Google Calendar auth is broken or the network to Google is flaky.
export async function scheduleCandidateInterview(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const {
    interviewStart: interviewStartStr,
    interviewEnd:   interviewEndStr,
    interviewLocation,
    interviewNotes,
    whatsappMessage,
    skipCalendar,
  } = req.body as {
    interviewStart?: string;
    interviewEnd?: string;
    interviewLocation?: string | null;
    interviewNotes?: string | null;
    whatsappMessage?: string;
    skipCalendar?: boolean;
  };

  const [candidate] = await db.select().from(candidates).where(and(eq(candidates.id, id), isNull(candidates.deletedAt))).limit(1);
  if (!candidate) { res.status(404).json({ message: 'Candidate not found' }); return; }
  if (!interviewStartStr) { res.status(400).json({ message: 'interviewStart is required' }); return; }

  const start = new Date(interviewStartStr);
  // Duration defaults to the `interview_duration_minutes` setting so
  // admins can tune it without a code change.
  const [durationSetting] = await db.select().from(systemSettings)
    .where(eq(systemSettings.key, 'interview_duration_minutes')).limit(1);
  const durationMin = Number(durationSetting?.value) || 45;
  const end   = interviewEndStr ? new Date(interviewEndStr) : new Date(start.getTime() + durationMin * 60_000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ message: 'Invalid interviewStart/interviewEnd' }); return;
  }

  // Bump status forward the same way the frontend used to. NEW / CONTACTED
  // become CONTACTED (invitation sent, waiting confirmation); later stages
  // keep their current status.
  const nextStatus = (candidate.status === 'NEW' || candidate.status === 'CONTACTED')
    ? 'CONTACTED' as const : candidate.status;

  const persistDb = async (extra: Partial<{
    interviewEventId: string | null; interviewEventLink: string | null; interviewCalendarId: string | null;
  }> = {}) => {
    await db.update(candidates).set({
      interviewStart: start,
      interviewEnd: end,
      interviewLocation: interviewLocation?.trim() || null,
      interviewNotes: interviewNotes ?? null,
      status: nextStatus,
      statusChangedAt: candidate.status !== nextStatus ? new Date() : (candidate.statusChangedAt ?? undefined),
      ...extra,
    }).where(eq(candidates.id, id));
  };

  if (skipCalendar) {
    await persistDb({ interviewCalendarId: null });
    res.json({ interviewEventId: null, interviewEventLink: null, calendarSynced: false });
    return;
  }

  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) {
    res.status(409).json({ message: 'Google calendar not connected' });
    return;
  }

  const [ivCalendarSetting, calendarSetting, addressSetting] = await Promise.all([
    db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'kinder_address')).limit(1).then(r => r[0]),
  ]);
  // Interview-specific calendar takes priority over the general shared
  // one so HR can route interviews to a private calendar. Falls back to
  // shared_calendar_id if the admin hasn't configured a dedicated one.
  const rawCalendarId = (ivCalendarSetting?.value ?? calendarSetting?.value ?? 'primary') as string;
  const calendarId = String(rawCalendarId).replace(/^"|"$/g, '');
  const kinderAddress = (addressSetting?.value as string | undefined) ?? '';

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

  // Reschedule → delete the prior event before booking the new one.
  // The prior event may live on a different calendar (admin picked a
  // different one this time) — use the stored calendarId if we have it.
  if (candidate.interviewEventId) {
    const priorCalendarId = candidate.interviewCalendarId ?? calendarId;
    try {
      await calendar.events.delete({ calendarId: priorCalendarId, eventId: candidate.interviewEventId });
    } catch { /* ignore: event may have already been deleted */ }
  }

  const eventLocation = interviewLocation?.trim() || kinderAddress;
  // Event description mirrors the leads flow's format so both feeds
  // read consistently on the shared HR calendar.
  const normalizePhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    return digits.startsWith('0') ? '60' + digits.slice(1) : digits;
  };
  const description = [
    candidate.phone ? `Candidate Phone: ${candidate.phone}` : '',
    candidate.desiredPosition ? `Position: ${candidate.desiredPosition}` : '',
    candidate.experienceRange ? `Experience: ${candidate.experienceRange}` : '',
    candidate.qualification ? `Qualification: ${candidate.qualification}` : '',
    candidate.expectedSalary != null ? `Expected Salary: RM ${candidate.expectedSalary.toLocaleString()}` : '',
    `Submitted: ${candidate.submittedAt.toISOString()}`,
    candidate.phone ? `\nWhatsApp: https://web.whatsapp.com/send?phone=${normalizePhone(candidate.phone)}` : '',
    interviewNotes ? `\nNotes:\n${interviewNotes}` : '',
  ].filter(Boolean).join('\n');

  let event;
  try {
    // 【PH】 (placeholder) prefix while the candidate hasn't confirmed
    // — mirrors the leads flow. The prefix drops when the admin flips
    // the candidate to INTERVIEWING (see the rename logic in
    // updateCandidate). Anything past CONTACTED is already confirmed
    // and gets a clean title.
    const isPlaceholder = nextStatus === 'CONTACTED';
    event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `${isPlaceholder ? '【PH】' : ''}Interview - ${candidate.fullName}${candidate.desiredPosition ? ` (${candidate.desiredPosition})` : ''}`,
        description,
        location: eventLocation,
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
        end:   { dateTime: end.toISOString(),   timeZone: 'Asia/Kuala_Lumpur' },
      },
    });
  } catch (err: any) {
    console.log('[Google Calendar] Failed to create candidate interview event:', err?.response?.data ?? err?.message);
    res.status(502).json({ message: `Google Calendar error: ${err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'}` });
    return;
  }

  await persistDb({
    interviewEventId: event.data.id ?? null,
    interviewEventLink: event.data.htmlLink ?? null,
    interviewCalendarId: calendarId,
  });

  res.json({
    interviewEventId: event.data.id,
    interviewEventLink: event.data.htmlLink,
    calendarSynced: true,
  });
}

// Deletes the calendar event and clears interview fields on the record.
// Used when the interview is cancelled outright (as opposed to
// rescheduled, which reuses scheduleCandidateInterview).
export async function unscheduleCandidateInterview(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [candidate] = await db.select().from(candidates).where(and(eq(candidates.id, id), isNull(candidates.deletedAt))).limit(1);
  if (!candidate) { res.status(404).json({ message: 'Candidate not found' }); return; }

  if (candidate.interviewEventId) {
    const [connection] = await db.select().from(googleConnections).limit(1);
    if (connection) {
      const [ivSetting, calendarSetting] = await Promise.all([
        db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1).then(r => r[0]),
        db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
      ]);
      const calendarId = candidate.interviewCalendarId
        ?? String(ivSetting?.value ?? calendarSetting?.value ?? 'primary').replace(/^"|"$/g, '');
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
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      try {
        await calendar.events.delete({ calendarId, eventId: candidate.interviewEventId });
      } catch { /* ignore */ }
    }
  }

  await db.update(candidates).set({
    interviewStart: null,
    interviewEnd: null,
    interviewLocation: null,
    interviewEventId: null,
    interviewEventLink: null,
    interviewCalendarId: null,
  }).where(eq(candidates.id, id));

  res.json({ ok: true });
}

export async function getCandidateById(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const [row] = await db.select().from(candidates).where(and(eq(candidates.id, id), isNull(candidates.deletedAt))).limit(1);
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(row);
}

export async function updateCandidate(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const parsed = updateCandidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  const [existing] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const patch: Record<string, any> = {};
  const assign = (key: keyof typeof data, transform?: (v: any) => any) => {
    if (key in data) patch[key as string] = transform ? transform(data[key]) : data[key];
  };
  assign('fullName', v => v == null ? null : titleCaseName(v.trim()));
  assign('phone', v => v?.trim());
  assign('addressLocation', v => (v == null ? null : v.trim() || null));
  assign('commuteTime');
  assign('desiredPosition', v => (v == null ? null : v.trim() || null));
  assign('expectedSalary');
  assign('experienceRange', v => (v == null ? null : v.trim() || null));
  assign('qualification', v => (v == null ? null : v.trim() || null));
  assign('qualificationOther', v => (v == null ? null : v.trim() || null));
  assign('salaryJustification', v => (v == null ? null : v.trim() || null));
  assign('careerGoals', v => (v == null ? null : v.trim() || null));
  assign('whyKindergartenTeacher', v => (v == null ? null : v.trim() || null));
  assign('isShortlisted');
  assign('howDidYouKnow', v => (v == null ? null : v.trim() || null));
  assign('interviewLocation', v => (v == null ? null : v.trim() || null));
  assign('interviewNotes', v => (v == null ? null : v));
  assign('rejectionReason', v => (v == null ? null : v));
  assign('notes', v => (v == null ? null : v));
  assign('adminNotes', v => (v == null ? null : v));

  if ('dob' in data) patch.dob = data.dob == null ? null : parseDate(data.dob) ?? null;
  if ('availableFrom' in data) patch.availableFrom = data.availableFrom == null ? null : parseDate(data.availableFrom) ?? null;
  if ('preferredStartDate' in data) patch.preferredStartDate = data.preferredStartDate == null ? null : parseDate(data.preferredStartDate) ?? null;
  if ('interviewStart' in data) patch.interviewStart = data.interviewStart == null ? null : parseDate(data.interviewStart) ?? null;
  if ('interviewEnd' in data) patch.interviewEnd = data.interviewEnd == null ? null : parseDate(data.interviewEnd) ?? null;
  if ('hiredAt' in data) patch.hiredAt = data.hiredAt == null ? null : parseDate(data.hiredAt) ?? null;

  // Status transitions — stamp statusChangedAt when status flips, default
  // hiredAt to now on HIRED unless the admin set it explicitly.
  if (data.status && data.status !== existing.status) {
    patch.status = data.status;
    patch.statusChangedAt = parseDate(data.statusChangedAt as any) ?? new Date();
    if (data.status === 'HIRED' && !('hiredAt' in data)) {
      patch.hiredAt = new Date();
    }
  } else if ('statusChangedAt' in data) {
    patch.statusChangedAt = parseDate(data.statusChangedAt as any) ?? null;
  }

  if (Object.keys(patch).length === 0) {
    res.json(existing);
    return;
  }

  await db.update(candidates).set(patch).where(eq(candidates.id, id));
  let [updated] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);

  // If the candidate just moved past CONTACTED (they confirmed the
  // interview), strip the 【PH】 prefix from their calendar event so the
  // shared HR calendar reads as a confirmed booking.
  if (
    updated?.interviewEventId
    && data.status
    && existing.status === 'CONTACTED'
    && data.status !== 'CONTACTED'
    && data.status !== 'NEW'
  ) {
    try {
      await renameCandidateInterviewEvent(updated.interviewEventId, updated.interviewCalendarId, updated.fullName, updated.desiredPosition);
    } catch (err: any) {
      // Non-fatal: the record update succeeded, we just couldn't rename.
      console.log('[Google Calendar] Failed to strip 【PH】 from candidate event:', err?.response?.data ?? err?.message);
    }
  }

  // If the candidate was just rejected or talent-banked AND has an
  // interview still ahead, cancel the interview: nuke the calendar event
  // and clear the schedule fields on the record. Past interviews (already
  // happened) are left alone — they're history, not something to un-do.
  if (
    updated
    && (data.status === 'REJECTED' || data.status === 'TALENT_BANK')
    && existing.status !== data.status
    && updated.interviewStart
    && updated.interviewStart.getTime() > Date.now()
  ) {
    if (updated.interviewEventId) {
      try {
        await deleteCandidateInterviewEvent(updated.interviewEventId, updated.interviewCalendarId);
      } catch (err: any) {
        // Non-fatal: DB cleanup below still happens even if calendar
        // delete fails (event may have been removed manually already).
        console.log('[Google Calendar] Failed to delete cancelled interview event:', err?.response?.data ?? err?.message);
      }
    }
    await db.update(candidates).set({
      interviewStart: null,
      interviewEnd: null,
      interviewLocation: null,
      interviewNotes: null,
      interviewEventId: null,
      interviewEventLink: null,
      interviewCalendarId: null,
    }).where(eq(candidates.id, id));
    [updated] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  }

  res.json(updated);
}

// Delete a candidate's calendar event. Used when a rejection cancels an
// upcoming interview. Falls back through the same setting chain the
// scheduler uses so the event is findable even if the tenant default has
// changed since it was booked.
async function deleteCandidateInterviewEvent(eventId: string, storedCalendarId: string | null): Promise<void> {
  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) return;
  let calendarId = storedCalendarId;
  if (!calendarId) {
    const [ivSetting, calendarSetting] = await Promise.all([
      db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1).then(r => r[0]),
      db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    ]);
    calendarId = String(ivSetting?.value ?? calendarSetting?.value ?? 'primary').replace(/^"|"$/g, '');
  }

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
  await calendar.events.delete({ calendarId, eventId });
}

// Rename a candidate's calendar event to drop the 【PH】 (placeholder)
// prefix. Called when the candidate confirms their interview slot.
async function renameCandidateInterviewEvent(eventId: string, storedCalendarId: string | null, fullName: string, desiredPosition: string | null): Promise<void> {
  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) return;
  let calendarId = storedCalendarId;
  if (!calendarId) {
    const [ivSetting, calendarSetting] = await Promise.all([
      db.select().from(systemSettings).where(eq(systemSettings.key, 'interview_calendar_id')).limit(1).then(r => r[0]),
      db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    ]);
    calendarId = String(ivSetting?.value ?? calendarSetting?.value ?? 'primary').replace(/^"|"$/g, '');
  }

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
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      summary: `Interview - ${fullName}${desiredPosition ? ` (${desiredPosition})` : ''}`,
    },
  });
}

export async function deleteCandidate(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  await db.update(candidates).set({ deletedAt: new Date() }).where(eq(candidates.id, id));
  res.json({ ok: true });
}

// ── Resume upload (public) ─────────────────────────────────────────────────
// Multer is wired in candidates.routes.ts; by the time this handler runs the
// file is already on disk under PRIVATE_UPLOAD_ROOT/resumes. We then verify
// the magic bytes, candidate exists, and the window/one-shot constraints
// hold. On any failure we unlink the temp file so a rejected upload never
// lingers on disk.
export async function uploadCandidateResume(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const file = (req as any).file as Express.Multer.File | undefined;

  const cleanup = () => {
    if (file?.path) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
  };

  if (!file) {
    res.status(400).json({ message: 'No file uploaded.' });
    return;
  }

  // Look up candidate first — fail fast if id is bogus.
  const [c] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (!c || c.deletedAt) {
    cleanup();
    res.status(404).json({ message: 'Candidate not found.' });
    return;
  }
  if (c.resumePath) {
    cleanup();
    res.status(409).json({ message: 'A resume has already been uploaded.' });
    return;
  }
  if (Date.now() - new Date(c.submittedAt).getTime() > RESUME_UPLOAD_WINDOW_MS) {
    cleanup();
    res.status(410).json({ message: 'Upload window expired. Please contact us to send your resume.' });
    return;
  }

  // Magic-byte check on the first 8 bytes of what's actually on disk.
  let head: Buffer;
  try {
    const fd = fs.openSync(file.path, 'r');
    head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
  } catch {
    cleanup();
    res.status(400).json({ message: 'Could not read uploaded file.' });
    return;
  }
  const ext = checkResumeMagic(head, file.mimetype);
  if (!ext) {
    cleanup();
    res.status(400).json({ message: 'File contents do not match a valid PDF.' });
    return;
  }

  // Move to candidate-scoped final path with a fresh UUID name. The
  // original filename is kept ONLY in DB metadata for the download response.
  const finalDir = path.join(RESUMES_DIR, id);
  fs.mkdirSync(finalDir, { recursive: true });
  const finalName = `${randomUUID()}${ext}`;
  const finalPath = path.join(finalDir, finalName);
  try {
    fs.renameSync(file.path, finalPath);
  } catch (e) {
    cleanup();
    res.status(500).json({ message: 'Failed to save uploaded file.' });
    return;
  }

  const relPath = path.relative(PRIVATE_UPLOAD_ROOT, finalPath).split(path.sep).join('/');
  // Strip any path separators from the original filename so a malicious
  // candidate can't inject a path via Content-Disposition later.
  const safeOriginal = file.originalname.replace(/[/\\\r\n"]/g, '_').slice(0, 200);

  await db.update(candidates)
    .set({ resumePath: relPath, resumeOriginalName: safeOriginal })
    .where(eq(candidates.id, id));

  res.json({ ok: true });
}

// ── Resume download (admin) ────────────────────────────────────────────────
// Resolves the stored relative path against PRIVATE_UPLOAD_ROOT and rejects
// any result that escapes that root (defence in depth — the path is set by
// our own upload handler, but treating it as untrusted is cheap).
export async function downloadCandidateResume(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const [c] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (!c || c.deletedAt || !c.resumePath) {
    res.status(404).json({ message: 'Resume not found.' });
    return;
  }

  const abs = path.resolve(PRIVATE_UPLOAD_ROOT, c.resumePath);
  const rootWithSep = PRIVATE_UPLOAD_ROOT.endsWith(path.sep) ? PRIVATE_UPLOAD_ROOT : PRIVATE_UPLOAD_ROOT + path.sep;
  if (!abs.startsWith(rootWithSep) || !fs.existsSync(abs)) {
    res.status(404).json({ message: 'Resume file is missing on disk.' });
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
  // Force download (no inline render) and use the original filename so the
  // admin gets something they can recognize.
  const downloadName = c.resumeOriginalName ?? `resume-${id}${ext}`;
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '\\"')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(abs).pipe(res);
}

// ── Dummy seed (dev / demo) ─────────────────────────────────────────────────
// Inserts a spread of realistic Malaysian kindergarten teacher candidates so
// the admin can see the list features (flags, shortlist, filters, densities)
// working before real applications arrive. Idempotency-friendly: skips names
// that already exist in the DB.

const SEED_NAMES = [
  'Nur Aina Binti Ahmad', 'Siti Nurhaliza Binti Ismail', 'Farah Diana Binti Yusof',
  'Aisyah Binti Rahman', 'Nurul Huda Binti Zainal', 'Lim Xin Yi', 'Tan Mei Ling',
  'Wong Siew Fen', 'Chan Hui Min', 'Yap Zi Xuan', 'Priya Devi A/P Nathan',
  'Kavitha A/P Rajendran', 'Divya A/P Kumar', 'Anushka A/P Suresh',
  'Nurin Adzlin Binti Hakim', 'Grace Ong Li Wen', 'Michelle Teo Sze Ling',
  'Vasanthi A/P Muthu', 'Nur Fatin Binti Salleh', 'Chin Wei Ling',
  'Amira Binti Zulkifli', 'Lee Xin Hui', 'Kaviya A/P Selvarajah',
  'Zaharah Binti Mohd Nasir', 'Ho Yuan Ting',
];
const SEED_ADDRESSES = [
  'Bukit Indah', 'Taman Perling', 'Nusa Bestari', 'Horizon Hills',
  'Iskandar Puteri', 'Skudai', 'Larkin', 'Taman Molek', 'Pasir Gudang',
  'Ulu Tiram', 'Tampoi', 'Taman Sutera Utama', 'Mount Austin', 'Kempas',
  'Danga Bay',
];
const SEED_COMMUTES = ['UNDER_15', 'MIN_15_30', 'MIN_30_45', 'MIN_45_60', 'OVER_60', 'WILL_MOVE'] as const;
const SEED_POSITIONS = ['Assistant Teacher', 'Junior Teacher', 'Senior Teacher', 'Kindergarten Helper'];
const SEED_QUALIFICATIONS = ['SPM / O Level', 'Diploma / STPM / UEC / A Level', "Bachelor's degree", 'Others'];
const SEED_EXPERIENCE = ['No experience', 'Less than 1 year', '1 – 2 years', '3 – 5 years', 'More than 5 years'];
const SEED_REFERRALS = ['Transfer from other Ten Toes branch', 'JobStreet', 'Indeed', 'Maukerja', 'Facebook Group', 'Facebook Ads', 'MyFuture Job', 'Other'];
const SEED_STATUSES = [
  'NEW', 'NEW', 'NEW', 'NEW', 'NEW', 'NEW', 'NEW', 'NEW',        // 8 in inbox
  'CONTACTED', 'CONTACTED', 'CONTACTED',                          // 3 contacted
  'INTERVIEWING', 'INTERVIEWING',                                 // 2 interviewing
  'HIRED',                                                        // 1 hired
  'REJECTED', 'REJECTED',                                         // 2 rejected
] as const;
const SEED_CAREER_GOALS = [
  'To become a lead teacher within three years and eventually take on curriculum design responsibilities.',
  'Grow into a senior teacher role and mentor new teachers.',
  'Learn from experienced educators, build strong classroom management skills.',
  'Open my own small tuition centre after gaining 5 years of experience here.',
  'To keep teaching young children — I don\'t want to leave the classroom.',
  'Complete my degree part-time while working and move into a curriculum coordinator role.',
  'To gain more experience in teaching', // deliberately low-effort — should be filtered
];
const SEED_WHY_KG = [
  'I love the energy of young children and want to make a real difference in their earliest years.',
  'I taught primary before but realised kindergarten is where the foundation is built.',
  'My own kids attended a caring kindergarten and I want to give the same to other families.',
  'I have always been drawn to teaching younger children — the honesty and curiosity at this age is unique.',
  'Because I need to work with children close to my area.',
  'To gain experience', // deliberately low-effort
];
const SEED_JUSTIFICATIONS = [
  '3 years teaching K1 and K2 at Little Stars Kindergarten, Diploma in Early Childhood Education from Kolej Vokasional.',
  '1 year assistant teaching at Playhouse Preschool. Trained in Montessori basics through a short course.',
  'Recently completed Bachelor in ECE. Six months of practical training at a play-based centre in JB.',
  '5 years experience teaching 4-6 year olds. Familiar with British and Malaysian curriculum.',
  'No prior kindergarten experience but 2 years running an in-home tuition class for K2 children.',
  'Two years as a helper at a daycare centre, hands-on with toddlers and pre-schoolers daily.',
];

/** Simple deterministic-ish picker to keep the distribution varied. */
function pick<T>(arr: readonly T[], i: number): T { return arr[i % arr.length]; }
function pickRand<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export async function seedDummyCandidates(_req: Request, res: Response): Promise<void> {
  // Skip names we already have — makes the endpoint idempotent-ish.
  const existing = await db.select().from(candidates);
  const existingNames = new Set(existing.map(c => c.fullName.toLowerCase()));

  const rows: any[] = [];
  const now = Date.now();

  for (let i = 0; i < SEED_NAMES.length; i++) {
    const name = SEED_NAMES[i];
    if (existingNames.has(name.toLowerCase())) continue;

    const status = pick(SEED_STATUSES, i);
    const position = pick(SEED_POSITIONS, i);
    // Salary jitter — some above/under the band so red/yellow flags fire.
    let salary: number;
    if (i % 7 === 0) salary = 4500;      // above band → red flag
    else if (i % 11 === 0) salary = 1600; // under band with experience → yellow flag
    else salary = 2000 + (i * 137) % 1500; // regular spread
    const commute = pick(SEED_COMMUTES, i);
    // Ensure a few OVER_60 fire the long-commute flag
    const finalCommute = (i % 9 === 0) ? 'OVER_60' : commute;

    const submittedAt = new Date(now - (i * 4 + Math.floor(Math.random() * 24)) * 60 * 60 * 1000);
    const dob = new Date(1985 + (i % 20), i % 12, 5 + (i % 20));

    rows.push({
      id: randomUUID(),
      submittedAt,
      fullName: name,
      phone: `01${(1 + i % 9)}-${String(1000000 + (i * 313) % 9000000).slice(0, 7)}`,
      dob,
      addressLocation: pick(SEED_ADDRESSES, i),
      commuteTime: finalCommute,
      desiredPosition: position,
      expectedSalary: salary,
      salaryJustification: pick(SEED_JUSTIFICATIONS, i),
      availableFrom: new Date(now + (5 + i * 3) * 24 * 60 * 60 * 1000),
      preferredStartDate: new Date(now + (14 + i * 4) * 24 * 60 * 60 * 1000),
      experienceRange: pick(SEED_EXPERIENCE, i),
      qualification: pick(SEED_QUALIFICATIONS, i),
      qualificationOther: pick(SEED_QUALIFICATIONS, i) === 'Others'
        ? pick(['Certificate in Childcare', 'Diploma in Music Education', 'Pursuing Bachelor of Education'], i)
        : null,
      careerGoals: pick(SEED_CAREER_GOALS, i),
      whyKindergartenTeacher: pick(SEED_WHY_KG, i),
      howDidYouKnow: pick(SEED_REFERRALS, i),
      notes: i % 5 === 0 ? 'Referred by existing teacher' : null,
      status,
      statusChangedAt: submittedAt,
      isShortlisted: i % 6 === 0,      // ~15% shortlisted
    });
  }

  if (rows.length === 0) {
    res.json({ message: 'No new candidates seeded (all names already exist).', inserted: 0 });
    return;
  }

  await db.insert(candidates).values(rows);
  res.json({ message: `Seeded ${rows.length} candidates.`, inserted: rows.length });
}
