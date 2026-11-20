import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { notificationMutes, notifications, userAuthRoles, users } from '../../db/schema.js';
import { getNotificationSettings, saveNotificationSettings } from '../../controllers/notifications.controller.js';
import { notify } from '../../services/notifications.service.js';
import { incidentMessage, newLeadMessage } from '../../services/notifications.logic.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Who hears about what follows their roles — the same access as the page the
// notification opens. Settings only offers what your roles give you.

const NOW = new Date('2026-01-01T00:00:00Z');
const MARK = { id: 'u-mark', email: 'mark@kindertech.test', role: 'USER' };   // Marketing Executive
const SAM = { id: 'u-sam', email: 'sam@kindertech.test', role: 'USER' };      // Supervisor
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' };

beforeEach(async () => {
  await resetTables(notifications, notificationMutes, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: MARK.id, email: MARK.email, role: 'USER' }),
    await activeUser({ id: SAM.id, email: SAM.email, role: 'USER' }),
    await activeUser({ id: ADMIN.id, email: ADMIN.email, role: 'ADMIN' }),
  ]);
  await db.insert(userAuthRoles).values([
    { id: 'uar-1', userId: MARK.id, authRoleId: 'builtin:MARKETING_EXECUTIVE', createdAt: NOW },
    { id: 'uar-2', userId: SAM.id, authRoleId: 'builtin:SUPERVISOR', createdAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

const kindsFor = async (userId: string) => (await db.select().from(notifications).where(eq(notifications.userId, userId))).map(n => n.kind);
const settings = async (user: typeof MARK) => {
  const r = res(); await getNotificationSettings(reqWith({ user }), r);
  return r.body.events as { kind: string; category: string; from: string[]; enabled: boolean }[];
};

describe('Notifications — by role', () => {
  it('sends each event to the people whose roles open its page (and admins), not to everyone', async () => {
    await notify(newLeadMessage({ id: 'l1', childName: 'Aisha' }));
    await notify(incidentMessage({ id: 'i1', location: 'Playground', reportedByName: 'Tina' }));
    expect(await kindsFor(MARK.id)).toEqual(['NEW_LEAD']);
    expect(await kindsFor(SAM.id)).toEqual(['INCIDENT_REPORTED']);
    expect((await kindsFor(ADMIN.id)).sort()).toEqual(['INCIDENT_REPORTED', 'NEW_LEAD']);
  });

  it('doesn’t tell someone about what they did themselves', async () => {
    await notify(incidentMessage({ id: 'i1', location: 'Playground', reportedByName: 'Sam' }), { actorUserId: SAM.id });
    expect(await kindsFor(SAM.id)).toEqual([]);
    expect(await kindsFor(ADMIN.id)).toEqual(['INCIDENT_REPORTED']);
  });

  it('offers each person only the notifications their roles give, saying which role', async () => {
    expect(await settings(MARK)).toEqual([expect.objectContaining({ kind: 'NEW_LEAD', category: 'Marketing', from: ['Marketing Executive'], enabled: true })]);
    const sam = await settings(SAM);
    expect(sam.map(e => e.kind)).toEqual(['APPRAISAL_SIGN_OFF', 'INCIDENT_REPORTED', 'ITEM_REQUESTED', 'GUIDE_SUGGESTED']);
    expect(sam.every(e => e.from.join() === 'Supervisor')).toBe(true);
    expect((await settings(ADMIN)).every(e => e.from.join() === 'Admin account')).toBe(true);
  });

  it('refuses switching off a notification your roles don’t give you', async () => {
    const r = res(); await saveNotificationSettings(reqWith({ user: MARK, body: { muted: ['INCIDENT_REPORTED'] } }), r);
    expect(r.statusCode).toBe(400);
    const ok = res(); await saveNotificationSettings(reqWith({ user: MARK, body: { muted: ['NEW_LEAD'] } }), ok);
    expect(ok.statusCode).toBe(200);
  });
});
