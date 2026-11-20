import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { bugReports, notificationMutes, notifications, sopTemplateRevisions, teachers, users } from '../../db/schema.js';
import { createBugReport } from '../../controllers/bug-reports.controller.js';
import { createRevision } from '../../controllers/sop-revisions.controller.js';
import { tickMyOnboarding } from '../../controllers/staff-onboarding.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// The events behind the bell, through the real handlers: each tells admins
// once, at the moment something needs them.

const NOW = new Date('2026-01-01T00:00:00Z');
const ADMIN_ID = 'u-admin';
const TINA = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-tina' };

beforeEach(async () => {
  await resetTables(notifications, notificationMutes, bugReports, sopTemplateRevisions, teachers, users);
  await db.insert(users).values([
    await activeUser({ id: ADMIN_ID, email: 'admin@kindertech.test', role: 'ADMIN' }),
    await activeUser({ id: TINA.id, email: TINA.email, name: 'Tina Teacher', role: 'USER', teacherId: TINA.teacherId }),
  ]);
});
afterAll(async () => { await pool.end(); });

const adminInbox = async () => (await db.select().from(notifications).where(eq(notifications.userId, ADMIN_ID)))
  .map(n => ({ kind: n.kind, title: n.title, link: n.link }));

describe('Notifications — the events', () => {
  it('a bug report tells admins, and opens the bug reports page', async () => {
    await createBugReport(reqWith({ user: TINA, body: { title: 'Save does nothing', message: 'Tapped Save on Pay.' } }), res());
    expect(await adminInbox()).toEqual([{ kind: 'BUG_REPORTED', title: 'Bug reported: Save does nothing', link: '/tools/bug-reports' }]);
  });

  it('a guide suggestion tells admins once it’s sent for review — not while it’s a draft', async () => {
    const body = { title: 'Rainy-day pick-up', goal: 'Dry, calm pick-ups', steps: [{ section: 'Pick-up', title: 'Use the side door' }] };
    await createRevision(reqWith({ user: TINA, body: { ...body, asDraft: true } }), res());
    expect(await adminInbox()).toEqual([]);
    const r = res();
    await createRevision(reqWith({ user: TINA, body }), r);
    expect(await adminInbox()).toEqual([{ kind: 'GUIDE_SUGGESTED', title: 'New guide suggested: Rainy-day pick-up', link: `/hr/sop-revisions/${r.body.id}` }]);
  });

  it('a new joiner finishing their own checklist tells admins once — not on every tick', async () => {
    await db.insert(teachers).values({
      id: TINA.teacherId, name: 'Tina Teacher', color: '#7c3aed', createdAt: NOW, updatedAt: NOW,
      selfOnboardingProgress: [{ task: 'Read the handbook', done: false }, { task: 'Meet your buddy', done: false }],
    } as never);
    const tick = async (done: boolean[]) => tickMyOnboarding(reqWith({ params: { teacherId: TINA.teacherId }, user: TINA, body: { done } }), res());
    await tick([true, false]);
    expect(await adminInbox()).toEqual([]);
    await tick([true, true]);
    await tick([true, true]);
    expect(await adminInbox()).toEqual([{ kind: 'ONBOARDING_SELF_DONE', title: 'Tina Teacher finished their onboarding checklist', link: '/hr/onboarding' }]);
  });
});
