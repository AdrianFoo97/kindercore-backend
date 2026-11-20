import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  incidentReportLogs, incidentReportStudents, incidentReports, notificationMutes, notifications, pointsTransactions,
  purchaseRequestLogs, purchaseRequests, rewardRedemptions, teachers, userAuthRoles, users,
} from '../../db/schema.js';
import { approvePurchase, createPurchaseRequest, markPurchaseNotBuying } from '../../controllers/purchase-requests.controller.js';
import { addIncidentLog, createIncident } from '../../controllers/incidents.controller.js';
import { grantPoints, updateRedemption } from '../../controllers/points.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// “About you” notifications, through the real handlers: a plain Teacher hears
// when something of theirs moves on — and only them, never about what they did.

const NOW = new Date('2026-01-01T00:00:00Z');
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
const TINA = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-tina' };
const OMAR = { id: 'u-omar', email: 'omar@kindertech.test', role: 'USER', teacherId: 't-omar' };

beforeEach(async () => {
  await resetTables(notifications, notificationMutes, userAuthRoles, purchaseRequestLogs, purchaseRequests, incidentReportLogs,
    incidentReportStudents, incidentReports, pointsTransactions, rewardRedemptions, teachers, users);
  await db.insert(teachers).values([
    { id: 't-tina', name: 'Tina Teacher', color: '#7c3aed', createdAt: NOW, updatedAt: NOW },
    { id: 't-omar', name: 'Omar Other', color: '#7c3aed', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(users).values([
    await activeUser({ id: ADMIN.id, email: ADMIN.email, name: 'Ada Admin' }),
    await activeUser({ id: TINA.id, email: TINA.email, name: 'Tina Teacher', role: 'USER', teacherId: TINA.teacherId }),
    await activeUser({ id: OMAR.id, email: OMAR.email, name: 'Omar Other', role: 'USER', teacherId: OMAR.teacherId }),
  ]);
  await db.insert(userAuthRoles).values([
    { id: 'uar-tina', userId: TINA.id, authRoleId: 'builtin:TEACHER', createdAt: NOW },
    { id: 'uar-omar', userId: OMAR.id, authRoleId: 'builtin:TEACHER', createdAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

const inbox = async (userId: string) => (await db.select().from(notifications).where(eq(notifications.userId, userId)))
  .map(n => ({ kind: n.kind, title: n.title, link: n.link }));

describe('Notifications — about you', () => {
  it('tells a teacher when their item request is approved or turned down — not anyone else', async () => {
    const ask = async (item: string) => { const r = res(); await createPurchaseRequest(reqWith({ user: TINA, body: { item, quantity: '2 boxes', purpose: 'Class' } }), r); return r.body.id; };
    const glue = await ask('Glue sticks');
    const paint = await ask('Paint');
    await approvePurchase(reqWith({ user: ADMIN, params: { id: glue } }), res());
    await markPurchaseNotBuying(reqWith({ user: ADMIN, params: { id: paint }, body: { reason: 'We still have some' } }), res());
    expect(await inbox(TINA.id)).toEqual(expect.arrayContaining([
      { kind: 'MY_REQUEST_UPDATE', title: 'Approved: Glue sticks × 2 boxes', link: '/teachers/t-tina/purchases' },
      { kind: 'MY_REQUEST_UPDATE', title: 'Not buying: Paint × 2 boxes', link: '/teachers/t-tina/purchases' },
    ]));
    expect(await inbox(TINA.id)).toHaveLength(2);
    expect(await inbox(OMAR.id)).toEqual([]);
  });

  it('tells the reporter when their incident report changes status', async () => {
    const r = res();
    await createIncident(reqWith({ user: TINA, body: {
      incidentDate: '2026-01-05', incidentTime: '10:30', location: 'Playground', description: 'Fell off the slide.',
      actionsTaken: 'Cleaned the knee.', studentIds: [], otherChildren: 'A visiting child',
    } }), r);
    expect(r.statusCode).toBe(201);
    await addIncidentLog(reqWith({ user: ADMIN, params: { id: r.body.id }, body: { note: 'Called the parent' } }), res()); // a note alone — quiet
    await addIncidentLog(reqWith({ user: ADMIN, params: { id: r.body.id }, body: { status: 'RESOLVED' } }), res());
    expect(await inbox(TINA.id)).toEqual([{ kind: 'MY_REPORT_UPDATE', title: 'Your incident report: Resolved', link: '/teachers/t-tina/incidents' }]);
  });

  it('tells a teacher when they’re granted points or a reward is delivered', async () => {
    await grantPoints(reqWith({ user: ADMIN, params: { teacherId: 't-tina' }, body: { amount: 50, label: 'Great parent feedback' } }), res());
    await db.insert(rewardRedemptions).values({
      id: 'rd-1', teacherId: 't-tina', rewardId: 'rw-1', label: 'Lunch voucher', icon: 'gift', pointsSpent: 10, status: 'redeemed',
      redemptionCode: 'ABC', redeemedDate: '2026-01-02', createdAt: NOW, updatedAt: NOW,
    });
    await updateRedemption(reqWith({ user: ADMIN, params: { id: 'rd-1' }, body: { status: 'delivered' } }), res());
    expect(await inbox(TINA.id)).toEqual(expect.arrayContaining([
      { kind: 'MY_POINTS', title: 'You received 50 points', link: '/teachers/t-tina/rewards' },
      { kind: 'MY_REWARD_DELIVERED', title: 'Reward delivered: Lunch voucher', link: '/teachers/t-tina/rewards' },
    ]));
    expect(await inbox(OMAR.id)).toEqual([]);
  });

  it('respects a teacher switching one off', async () => {
    await db.insert(notificationMutes).values({ id: 'm1', userId: TINA.id, kind: 'MY_POINTS', createdAt: NOW });
    await grantPoints(reqWith({ user: ADMIN, params: { teacherId: 't-tina' }, body: { amount: 5, label: 'Thanks' } }), res());
    expect(await inbox(TINA.id)).toEqual([]);
  });
});
