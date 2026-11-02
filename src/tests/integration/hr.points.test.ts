import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { teachers, positions, pointsTransactions, pointsRewardItems, rewardRedemptions } from '../../db/schema.js';
import {
  grantPoints, getTeacherPoints, redeemReward, updateTransaction, deleteTransaction, updateRedemption,
} from '../../controllers/points.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { positionRows, teacherRows } from '../fixtures/permissions.js';

// Teacher points: the only way in is a supervisor grant, the only way out
// is redeeming a reward. The balance is real value to staff, so it must
// never go negative or be spent twice.

const NOW = new Date('2026-01-01T00:00:00Z');
const HR = { id: 'u-hr', email: 'hr@kindertech.test', role: 'ADMIN', teacherId: null };
const T = 't-1';

beforeEach(async () => {
  await resetTables(pointsTransactions, rewardRedemptions, pointsRewardItems, teachers, positions);
  await db.insert(positions).values(positionRows);
  await db.insert(teachers).values(teacherRows);
  await db.insert(pointsRewardItems).values([
    { id: 'r-coffee', icon: 'mug', label: 'Coffee treat', cost: 80, createdAt: NOW, updatedAt: NOW },
    { id: 'r-gone', icon: 'gift', label: 'Sold out mug', cost: 10, stock: 'out', createdAt: NOW, updatedAt: NOW },
    { id: 'r-hidden', icon: 'gift', label: 'Retired prize', cost: 10, active: false, createdAt: NOW, updatedAt: NOW },
  ]);
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await pool.end(); });

async function grant(amount: number, teacherId = T) {
  const r = res();
  await grantPoints(reqWith({ params: { teacherId }, body: { amount, label: 'Great parent feedback' }, user: HR }), r);
  return r;
}
async function redeem(rewardId: string) {
  const r = res();
  await redeemReward(reqWith({ params: { teacherId: T }, body: { rewardId }, user: { ...HR, teacherId: T, role: 'USER' } }), r);
  return r;
}
async function balance() {
  const r = res();
  await getTeacherPoints(reqWith({ params: { teacherId: T } }), r);
  return r.body.balance as { current: number; earnedThisMonth: number; lifetimeEarned: number };
}
/** Insert a ledger row directly, with a fixed time so the order is certain. */
async function ledgerRow(id: string, delta: number, minute: number, redemptionId: string | null = null) {
  await db.insert(pointsTransactions).values({
    id, teacherId: T, kind: delta > 0 ? 'earned' : 'redeemed', label: id, delta, balanceAfter: 0,
    date: '2026-01-05', redemptionId, createdAt: new Date(Date.UTC(2026, 0, 5, 9, minute)),
  });
}

describe('HR — points balance', () => {
  it('adds a grant to the teacher\'s balance, this month\'s total and their lifetime total', async () => {
    expect((await grant(50)).statusCode).toBe(201);
    await grant(30);
    expect(await balance()).toEqual({ current: 80, earnedThisMonth: 80, lifetimeEarned: 80 });
  });

  it('takes points back with a negative adjustment, but never below zero', async () => {
    await grant(50);
    expect((await grant(-20)).statusCode).toBe(201);
    expect((await balance()).current).toBe(30);
    expect((await grant(-31)).statusCode).toBe(400);
    expect((await balance()).current).toBe(30);
  });

  it('dates a grant by the Malaysian day, so an early-morning grant on the 1st counts in the new month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T23:30:00Z')); // 1 April, 7:30am in Malaysia
    const r = await grant(10);
    expect(r.body.date).toBe('2026-04-01');
  });
});

describe('HR — redeeming rewards', () => {
  it('lets a teacher redeem a reward they can afford, taking the cost off their balance', async () => {
    await grant(100);
    const r = await redeem('r-coffee');
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ status: 'redeemed', pointsSpent: 80 });
    expect((await balance()).current).toBe(20);
  });

  it('refuses a reward the teacher can\'t afford, and takes nothing off', async () => {
    await grant(79);
    expect((await redeem('r-coffee')).statusCode).toBe(409);
    expect((await balance()).current).toBe(79);
    expect(await db.select().from(rewardRedemptions)).toHaveLength(0);
  });

  it('refuses a reward that is out of stock or no longer offered', async () => {
    await grant(100);
    expect((await redeem('r-gone')).statusCode).toBe(409);
    expect((await redeem('r-hidden')).statusCode).toBe(404);
    expect((await balance()).current).toBe(100);
  });

  it('charges only once when Redeem is tapped twice at the same moment', async () => {
    await grant(100); // enough for one 80-point reward, not two
    const [a, b] = await Promise.all([redeem('r-coffee'), redeem('r-coffee')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect((await balance()).current).toBe(20);
    expect(await db.select().from(rewardRedemptions)).toHaveLength(1);
  });
});

describe('HR — correcting the points ledger', () => {
  it('keeps every row\'s running balance right after an earlier grant is edited or deleted', async () => {
    await ledgerRow('g1', 50, 0);
    await ledgerRow('g2', 30, 1);
    await ledgerRow('g3', 20, 2);

    await updateTransaction(reqWith({ params: { id: 'g1' }, body: { amount: 40 } }), res());
    let rows = await db.select().from(pointsTransactions).orderBy(asc(pointsTransactions.createdAt));
    expect(rows.map(r => r.balanceAfter)).toEqual([40, 70, 90]);

    await deleteTransaction(reqWith({ params: { id: 'g2' } }), res());
    rows = await db.select().from(pointsTransactions).orderBy(asc(pointsTransactions.createdAt));
    expect(rows.map(r => r.balanceAfter)).toEqual([40, 60]);
  });

  it('refuses an edit or delete that would leave the balance below zero', async () => {
    await ledgerRow('g1', 100, 0);
    await ledgerRow('spend', -80, 1, 'rd-1');
    const edit = res();
    await updateTransaction(reqWith({ params: { id: 'g1' }, body: { amount: 50 } }), edit);
    expect(edit.statusCode).toBe(400);
    const del = res();
    await deleteTransaction(reqWith({ params: { id: 'g1' } }), del);
    expect(del.statusCode).toBe(400);
    expect((await balance()).current).toBe(20);
  });

  it('won\'t let HR edit or delete the points spent on a redemption', async () => {
    await ledgerRow('g1', 100, 0);
    await ledgerRow('spend', -80, 1, 'rd-1');
    const edit = res();
    await updateTransaction(reqWith({ params: { id: 'spend' }, body: { amount: -1 } }), edit);
    const del = res();
    await deleteTransaction(reqWith({ params: { id: 'spend' } }), del);
    expect([edit.statusCode, del.statusCode]).toEqual([400, 400]);
    expect((await balance()).current).toBe(20);
  });
});

describe('HR — fulfilling a redemption', () => {
  async function setStatus(id: string, status: string) {
    const r = res();
    await updateRedemption(reqWith({ params: { id }, body: { status } }), r);
    return r;
  }

  it('moves a redemption forward: redeemed, then pending, then delivered', async () => {
    await grant(100);
    const { id } = (await redeem('r-coffee')).body;
    expect((await setStatus(id, 'pending')).body.status).toBe('pending');
    expect((await setStatus(id, 'delivered')).body.status).toBe('delivered');
  });

  it('refuses to move a redemption backwards once it has moved on', async () => {
    await grant(100);
    const { id } = (await redeem('r-coffee')).body;
    await setStatus(id, 'delivered');
    expect((await setStatus(id, 'redeemed')).statusCode).toBe(400);
    expect((await setStatus(id, 'pending')).statusCode).toBe(400);
    const [row] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id));
    expect(row.status).toBe('delivered');
  });
});
