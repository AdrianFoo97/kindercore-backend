import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { notificationMutes, notifications, staffJoinRequests, users } from '../../db/schema.js';
import { getNotificationSettings, listMyNotifications, readAllNotifications, readNotification, saveNotificationSettings } from '../../controllers/notifications.controller.js';
import { submitStaffJoin } from '../../controllers/staff-joins.controller.js';
import { notify, purgeOldNotifications } from '../../services/notifications.service.js';
import { newLeadMessage } from '../../services/notifications.logic.js';
import { resetTables } from './testDb.js';
import { req, reqWith, res } from './http.js';
import { activeUser, pendingInvite } from '../fixtures/users.js';

// The bell: admins hear about new leads, applications, staff joining and
// incidents; each person sees and clears only their own.

const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' };
const OWNER = { id: 'u-owner', email: 'owner@kindertech.test', role: 'SUPERADMIN' };
const STAFF = { id: 'u-staff', email: 'staff@kindertech.test', role: 'USER' };

beforeEach(async () => {
  await resetTables(notifications, notificationMutes, staffJoinRequests, users);
  await db.insert(users).values([
    await activeUser({ id: ADMIN.id, email: ADMIN.email, role: 'ADMIN' }),
    await activeUser({ id: OWNER.id, email: OWNER.email, role: 'SUPERADMIN' }),
    await activeUser({ id: STAFF.id, email: STAFF.email, role: 'USER' }),
    pendingInvite({ id: 'u-invited', email: 'invited@kindertech.test', role: 'ADMIN' }),
  ]);
});
afterAll(async () => { await pool.end(); });

const mine = async (user: typeof ADMIN) => {
  const r = res(); await listMyNotifications(reqWith({ user }), r);
  return r.body as { items: { id: string; title: string; link: string; readAt: string | null }[]; unread: number };
};

describe('Notifications', () => {
  it('tells every signed-up admin about a new staff joiner — not staff, not unaccepted invites', async () => {
    const r = res();
    await submitStaffJoin(req({ fullName: 'Aisyah Rahman', phone: '0123456789', dob: '1998-04-12', email: 'a@b.my' }), r);
    expect(r.statusCode).toBe(201);
    expect((await mine(ADMIN)).items.map(n => [n.title, n.link])).toEqual([['New staff joining: Aisyah Rahman', '/hr/new-staff']]);
    expect((await mine(OWNER)).unread).toBe(1);
    expect((await mine(STAFF)).items).toEqual([]);
    expect((await db.select().from(notifications)).length).toBe(2);
  });

  it('lets each person mark their own read, one or all — never someone else’s', async () => {
    await notify(newLeadMessage({ id: 'l1', childName: 'Aisha' }));
    await notify(newLeadMessage({ id: 'l2', childName: 'Ben' }));
    const [first] = (await mine(ADMIN)).items;
    const other = res(); await readNotification(reqWith({ params: { id: first.id }, user: OWNER }), other);
    expect(other.statusCode).toBe(404);
    const r = res(); await readNotification(reqWith({ params: { id: first.id }, user: ADMIN }), r);
    expect(r.statusCode).toBe(200);
    expect((await mine(ADMIN)).unread).toBe(1);
    await readAllNotifications(reqWith({ user: ADMIN }), res());
    expect((await mine(ADMIN)).unread).toBe(0);
    expect((await mine(OWNER)).unread).toBe(2);
  });

  it('clears notifications older than 180 days', async () => {
    await notify(newLeadMessage({ id: 'l1', childName: 'Aisha' }));
    const later = new Date(Date.now() + 181 * 24 * 60 * 60 * 1000);
    expect(await purgeOldNotifications(later)).toBe(2);
    expect((await mine(ADMIN)).items).toEqual([]);
  });

  it('lets each admin switch an event off for themselves only, and refuses an unknown event', async () => {
    const save = async (user: typeof ADMIN, muted: string[]) => { const r = res(); await saveNotificationSettings(reqWith({ user, body: { muted } }), r); return r; };
    expect((await save(ADMIN, ['NEW_LEAD'])).statusCode).toBe(200);
    expect((await save(ADMIN, ['NOT_A_THING'])).statusCode).toBe(400);
    const s = res(); await getNotificationSettings(reqWith({ user: ADMIN }), s);
    const lead = (s.body.events as { kind: string; category: string; enabled: boolean }[]).find(e => e.kind === 'NEW_LEAD')!;
    expect(lead).toMatchObject({ category: 'Marketing', enabled: false });
    await notify(newLeadMessage({ id: 'l1', childName: 'Aisha' }));
    expect((await mine(ADMIN)).items).toEqual([]);
    expect((await mine(OWNER)).unread).toBe(1);
  });
});
