import { randomUUID } from 'crypto';
import { and, count, desc, eq, gte, like, lt, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sensitiveAccessLogs, teachers, users } from '../db/schema.js';

// Admin → Access Log: who opened sensitive records (pay, finance, appraisals,
// job applicants), and when. Written by the logSensitiveAccess middleware
// after a successful read. The app refetches data often, so one person
// opening one page is recorded once per few minutes, not on every refresh.

export const ACCESS_AREAS = {
  FINANCE: 'School finances',
  PAYROLL: 'Payroll',
  STAFF_PAY: 'A staff member’s pay',
  APPRAISALS: 'Appraisals',
  APPLICANTS: 'Job applicants',
} as const;
export type AccessArea = keyof typeof ACCESS_AREAS;

/** The same person opening the same page within this window is one entry. */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const RETENTION_DAYS = 365;
export const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/** In-memory "last recorded" times; the map is trimmed when it grows past this. */
const MAX_TRACKED = 5_000;

const lastRecorded = new Map<string, number>();

/** Should this view be recorded, or was the same one recorded moments ago? Updates `seen`. */
export function isNewView(key: string, now: number, seen: Map<string, number> = lastRecorded): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  if (seen.size >= MAX_TRACKED) {
    for (const [k, at] of seen) if (now - at >= DEDUPE_WINDOW_MS) seen.delete(k);
  }
  seen.set(key, now);
  return true;
}

export interface AccessView {
  userId: string;
  userEmail: string;
  area: AccessArea;
  action: string;
  subjectTeacherId: string | null;
  ip: string | null;
}

/** Record one view (deduplicated). Never throws — logging must not break the page. */
export async function recordAccess(v: AccessView, now = new Date()): Promise<void> {
  if (!isNewView(`${v.userId}|${v.area}|${v.action}|${v.subjectTeacherId ?? ''}`, now.getTime())) return;
  try {
    await db.insert(sensitiveAccessLogs).values({ id: randomUUID(), ...v, createdAt: now });
  } catch (err) {
    console.error('[access-log] could not record a view', err);
  }
}

/** Forget the dedupe memory (tests). */
export function resetAccessDedupe(): void { lastRecorded.clear(); }

export interface AccessLogFilters { days: number; area?: AccessArea; search?: string; page: number }

/** Newest first, with who opened it and whose record it was. */
export async function listAccessLog(f: AccessLogFilters, now = new Date()) {
  const since = new Date(now.getTime() - f.days * DAY_MS);
  const term = f.search?.trim();
  const where = and(
    gte(sensitiveAccessLogs.createdAt, since),
    f.area ? eq(sensitiveAccessLogs.area, f.area) : undefined,
    term ? or(like(users.name, `%${term}%`), like(sensitiveAccessLogs.userEmail, `%${term}%`), like(teachers.name, `%${term}%`)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: sensitiveAccessLogs.id, at: sensitiveAccessLogs.createdAt, userName: users.name, userEmail: sensitiveAccessLogs.userEmail,
      area: sensitiveAccessLogs.area, action: sensitiveAccessLogs.action, subjectName: teachers.name, ip: sensitiveAccessLogs.ip,
    }).from(sensitiveAccessLogs)
      .leftJoin(users, eq(users.id, sensitiveAccessLogs.userId))
      .leftJoin(teachers, eq(teachers.id, sensitiveAccessLogs.subjectTeacherId))
      .where(where).orderBy(desc(sensitiveAccessLogs.createdAt))
      .limit(PAGE_SIZE).offset((f.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(sensitiveAccessLogs)
      .leftJoin(users, eq(users.id, sensitiveAccessLogs.userId))
      .leftJoin(teachers, eq(teachers.id, sensitiveAccessLogs.subjectTeacherId))
      .where(where),
  ]);
  return {
    rows: rows.map(r => ({ ...r, areaLabel: ACCESS_AREAS[r.area as AccessArea] ?? r.area })),
    total: Number(total),
    page: f.page,
    pageSize: PAGE_SIZE,
  };
}

/** Delete entries older than RETENTION_DAYS. Returns how many went. */
export async function purgeOldAccessLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const [result] = await db.delete(sensitiveAccessLogs).where(lt(sensitiveAccessLogs.createdAt, cutoff));
  return (result as { affectedRows?: number }).affectedRows ?? 0;
}
