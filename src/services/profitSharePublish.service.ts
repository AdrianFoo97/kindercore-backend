import { randomUUID } from 'crypto';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { profitSharePublications, users } from '../db/schema.js';
import { computeFinanceMonths } from './finance.service.js';
import { monthPool } from './poolMath.service.js';
import { poolSettings } from './payPools.service.js';
import { notifyPeople } from './notifications.service.js';
import { profitSharePublishedMessage } from './notifications.logic.js';
import {
  MONTHS_IN_YEAR, publishProblem, publishedMonths, toSen, unpublishProblem, type PublishedMonth,
} from './profitSharePublish.logic.js';

// Publishing a month's profit-sharing pool (Analysis → Profit Sharing).
// The amount is worked out here, on the server, from the same pool maths
// as the reports — never typed in — and frozen when it's published.

export class PublishError extends Error {}

async function rowsFor(year: number) {
  return db.select().from(profitSharePublications).where(eq(profitSharePublications.year, year)).orderBy(asc(profitSharePublications.createdAt));
}

/** The published months of a year — what staff may see. */
export async function publishedMonthsOf(year: number): Promise<Map<number, PublishedMonth>> {
  return publishedMonths(await rowsFor(year), year);
}

/** Each month's team pool and annual-bonus contribution as they stand now (from the live figures). */
async function livePools(year: number) {
  const [{ months }, s] = await Promise.all([computeFinanceMonths(year), poolSettings()]);
  return Array.from({ length: MONTHS_IN_YEAR }, (_, mi) => ({
    ...monthPool(mi, months[mi], s.expenseTarget, s.profitSharePct),
    bonus: monthPool(mi, months[mi], s.expenseTarget, s.annualBonusPct).pool,
  }));
}

/** Every month's state for the Profit Sharing page: live pool, whether it can be published, what's published, and the history. */
export async function publicationOverview(year: number) {
  const [rows, live] = await Promise.all([rowsFor(year), livePools(year)]);
  const published = publishedMonths(rows, year);
  return {
    year,
    months: live.map(m => {
      const p = published.get(m.monthIdx);
      return {
        monthIdx: m.monthIdx,
        finished: !m.isForecast,
        livePool: toSen(m.pool),
        liveBonus: toSen(m.bonus),
        liveHit: m.hit,
        published: p ? { poolAmount: p.poolAmount, annualBonusAmount: p.annualBonusAmount, hit: p.hit, publishedAt: p.publishedAt, byName: p.byName } : null,
      };
    }),
    history: rows.map(r => ({
      month: r.month, action: r.action, poolAmount: r.poolAmount === null ? null : Number(r.poolAmount),
      annualBonusAmount: r.annualBonusAmount === null ? null : Number(r.annualBonusAmount),
      reason: r.reason, byName: r.byName, at: r.createdAt,
    })).reverse(),
  };
}

async function nameOf(userId: string, fallback: string): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name || fallback;
}

/** Publish a finished month: freeze its team pool and annual-bonus contribution, then tell every staff member. */
export async function publishMonth(year: number, month: number, by: { id: string; email: string }): Promise<void> {
  const [rows, live] = await Promise.all([rowsFor(year), livePools(year)]);
  const pool = live[month];
  const problem = publishProblem(publishedMonths(rows, year).has(month), pool.isForecast);
  if (problem) throw new PublishError(problem);
  await db.insert(profitSharePublications).values({
    id: randomUUID(), year, month, action: 'PUBLISHED', poolAmount: toSen(pool.pool).toFixed(2), annualBonusAmount: toSen(pool.bonus).toFixed(2), hit: pool.hit, reason: null,
    byUserId: by.id, byName: await nameOf(by.id, by.email), createdAt: new Date(),
  });
  const staff = await db.select({ id: users.id, teacherId: users.teacherId }).from(users)
    .where(and(eq(users.activated, true), isNotNull(users.teacherId)));
  for (const s of staff) {
    await notifyPeople(profitSharePublishedMessage({ teacherId: s.teacherId!, year, month }), [s.id], { actorUserId: by.id });
  }
}

/** Take a published month back (with a reason) — staff stop seeing it until it's published again. */
export async function unpublishMonth(year: number, month: number, reason: string, by: { id: string; email: string }): Promise<void> {
  const problem = unpublishProblem(publishedMonths(await rowsFor(year), year).has(month), reason);
  if (problem) throw new PublishError(problem);
  await db.insert(profitSharePublications).values({
    id: randomUUID(), year, month, action: 'UNPUBLISHED', poolAmount: null, annualBonusAmount: null, hit: null, reason: reason.trim(),
    byUserId: by.id, byName: await nameOf(by.id, by.email), createdAt: new Date(),
  });
}
