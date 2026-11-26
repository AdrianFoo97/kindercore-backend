import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  leads, notifications, packages, schoolNews, studentEnrollments, students, systemSettings, userAuthRoles, users,
} from '../../db/schema.js';
import { postEnrolmentNews } from '../../services/schoolNews.service.js';
import { ENROLMENT_NEWS_SETTING } from '../../services/schoolNews.logic.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { PKG, seedPackages } from '../fixtures/students.js';

// School news, over real HTTP: when the front desk enrols a child (a package
// assigned), everyone on the staff sees it on Home and is told — the class and
// start date only, never the child's name. Once per child; old imports aren't
// news; it can be switched off; the front desk can hide a post.

const NOW = new Date('2026-01-01T00:00:00Z');
const CHILD = 'Aisha Rahman';
const TINA_TEACHER = 't-tina';

let server: LiveServer;
let desk: Caller; // Front Desk Officer (Students)
let tina: Caller; // Teacher
let leadSeq = 0;

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTables(notifications, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-desk', email: 'desk@kindertech.test', name: 'Dana Desk', role: 'USER' }),
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', name: 'Tina Teacher', role: 'USER', teacherId: TINA_TEACHER }),
  ]);
  await db.insert(userAuthRoles).values([
    { id: 'uar-desk', userId: 'u-desk', authRoleId: 'builtin:FRONT_DESK_OFFICER', createdAt: NOW },
    { id: 'uar-tina', userId: 'u-tina', authRoleId: 'builtin:TEACHER', createdAt: NOW },
  ]);
  server = await startLiveServer();
  [desk, tina] = await Promise.all(['desk', 'tina'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
beforeEach(async () => {
  await resetTables(schoolNews, notifications, studentEnrollments, students, leads, packages);
  await db.delete(systemSettings).where(eq(systemSettings.key, ENROLMENT_NEWS_SETTING));
  await seedPackages();
});
afterAll(async () => {
  await db.delete(systemSettings).where(eq(systemSettings.key, ENROLMENT_NEWS_SETTING));
  await server?.close();
  await pool.end();
});

/** The front desk enrols a new child (from a lead) on the standard package. */
async function enrol(startDate: string): Promise<string> {
  leadSeq += 1;
  const leadId = `lead-news-${leadSeq}`;
  await db.insert(leads).values({ id: leadId, submittedAt: NOW, childName: CHILD, parentPhone: `01299${leadSeq}`, childDob: new Date('2021-06-01'), enrolmentYear: 2026 });
  const r = await desk.call('POST', '/api/students', { leadId, enrolmentYear: 2026, enrolmentMonth: 1, packageId: PKG.standard, startDate });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const newsFor = async (who: Caller) => (await who.call('GET', '/api/school-news')).body as { id: string; title: string; body: string }[];

describe('School news — a new enrolment', () => {
  it('shows every staff member the class and start date — never the child’s name — and tells them', async () => {
    await enrol(today());
    const news = await newsFor(tina);
    expect(news).toHaveLength(1);
    expect(news[0].title).toBe('A new friend is joining Kindergarten (5Y)!');
    expect(JSON.stringify(news)).not.toContain('Aisha');
    const told = await db.select().from(notifications).where(eq(notifications.userId, 'u-tina'));
    expect(told.filter(n => n.kind === 'SCHOOL_NEWS').map(n => n.link)).toEqual([`/teachers/${TINA_TEACHER}/home`]);
    expect(JSON.stringify(told.filter(n => n.kind === 'SCHOOL_NEWS'))).not.toContain('Aisha');
  });

  it('posts once per child, and not for an old start date (an import of past students)', async () => {
    const id = await enrol(today());
    await postEnrolmentNews(id);
    expect(await db.select().from(schoolNews)).toHaveLength(1);
    await enrol('2020-01-06');
    expect(await db.select().from(schoolNews)).toHaveLength(1);
  });

  it('can be switched off', async () => {
    await db.insert(systemSettings).values({ id: 'set-news-off', key: ENROLMENT_NEWS_SETTING, value: JSON.stringify(false), updatedAt: NOW });
    await enrol(today());
    expect(await newsFor(tina)).toEqual([]);
  });

  it('lets the front desk hide a post for everyone — a teacher can’t', async () => {
    await enrol(today());
    const [post] = await newsFor(tina);
    expect((await tina.call('POST', `/api/school-news/${post.id}/hide`)).status).toBe(403);
    expect((await desk.call('POST', `/api/school-news/${post.id}/hide`)).status).toBe(200);
    expect(await newsFor(tina)).toEqual([]);
    expect((await desk.call('POST', '/api/school-news/no-such/hide')).status).toBe(404);
  });
});
