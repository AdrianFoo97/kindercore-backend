import { randomUUID } from 'crypto';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { packages, schoolNews, students, systemSettings, users } from '../db/schema.js';
import { notifyPeople } from './notifications.service.js';
import { schoolNewsMessage } from './notifications.logic.js';
import { ENROLMENT_NEWS_SETTING, NEWS_SHOW_DAYS, enrolmentNews, enrolmentNewsOn, visibleNews } from './schoolNews.logic.js';

// School news on everyone's Home. Posted where a child actually becomes a
// student (a package assigned) — once per child — and every staff member is
// told. Only the class and start date are shared.

const DAY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_KEY = 'ER_DUP_ENTRY';

async function settingValue(key: string): Promise<unknown> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key));
  if (!row) return undefined;
  try { return typeof row.value === 'string' ? JSON.parse(row.value) : row.value; } catch { return row.value; }
}

/** Post the news that this student has enrolled — unless switched off, not news (an old start), or already posted. Never throws. */
export async function postEnrolmentNews(studentId: string, opts: { actorUserId?: string | null; now?: Date } = {}): Promise<void> {
  try {
    if (!enrolmentNewsOn(await settingValue(ENROLMENT_NEWS_SETTING))) return;
    const [s] = await db.select({ startDate: students.startDate, enrolledAt: students.enrolledAt, programme: packages.programme, age: packages.age })
      .from(students).innerJoin(packages, eq(packages.id, students.packageId)).where(eq(students.id, studentId));
    if (!s) return;
    const now = opts.now ?? new Date();
    const news = enrolmentNews({ programme: s.programme, age: s.age }, s.startDate ?? s.enrolledAt, now);
    if (!news) return;
    try {
      await db.insert(schoolNews).values({ id: randomUUID(), kind: 'ENROLMENT', sourceId: studentId, title: news.title, body: news.body, postedAt: now });
    } catch (e: any) {
      if (e?.code === DUPLICATE_KEY || e?.cause?.code === DUPLICATE_KEY) return; // already posted for this child
      throw e;
    }
    const staff = await db.select({ id: users.id, teacherId: users.teacherId }).from(users)
      .where(and(eq(users.activated, true), isNotNull(users.teacherId)));
    for (const p of staff) {
      await notifyPeople(schoolNewsMessage({ teacherId: p.teacherId!, title: news.title, body: news.body }), [p.id], { actorUserId: opts.actorUserId });
    }
  } catch (e) {
    console.warn('[school-news] Enrolment post skipped:', e instanceof Error ? e.message : e);
  }
}

/** What Home shows: recent posts nobody has hidden. Only the post itself — not which child it came from. */
export async function recentNews(now = new Date()) {
  const rows = await db.select().from(schoolNews).where(gte(schoolNews.postedAt, new Date(now.getTime() - NEWS_SHOW_DAYS * DAY_MS)));
  return visibleNews(rows, now).map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, postedAt: r.postedAt }));
}

/** Hide a post for everyone. False when there's no such post. */
export async function hideNews(id: string, by: { id: string }): Promise<boolean> {
  const [row] = await db.select({ id: schoolNews.id }).from(schoolNews).where(eq(schoolNews.id, id));
  if (!row) return false;
  await db.update(schoolNews).set({ hiddenAt: new Date(), hiddenByUserId: by.id }).where(eq(schoolNews.id, id));
  return true;
}
