import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { notifications, positions, profitSharePublications, sensitiveAccessLogs, teachers, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Analysis → Profit Sharing → publish a month, over real HTTP: only the
// Finance Manager may publish or take back (not even the Principal); staff
// see a month on Pay only once it's published, and are told when it is.

const NOW = new Date('2026-01-01T00:00:00Z');
const PAST_YEAR = 2025; // every month finished
const FUTURE_YEAR = 2099; // no month finished
const TINA_TEACHER = 't-tina';

let server: LiveServer;
let fiona: Caller; // Finance Manager
let pat: Caller; // Principal
let tina: Caller; // Teacher

beforeAll(async () => {
  await resetTables(notifications, profitSharePublications, sensitiveAccessLogs, userAuthRoles, users, teachers, positions);
  await db.insert(positions).values({ positionId: 'P-T', name: 'Teacher', createdAt: NOW, updatedAt: NOW } as never);
  await db.insert(teachers).values({ id: TINA_TEACHER, name: 'Tina Teacher', color: '#7c3aed', positionId: 'P-T', createdAt: NOW, updatedAt: NOW } as never);
  await db.insert(users).values([
    await activeUser({ id: 'u-fiona', email: 'fiona@kindertech.test', name: 'Fiona Finance', role: 'USER' }),
    await activeUser({ id: 'u-pat', email: 'pat@kindertech.test', name: 'Pat Principal', role: 'USER' }),
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', name: 'Tina Teacher', role: 'USER', teacherId: TINA_TEACHER }),
  ]);
  await db.insert(userAuthRoles).values([
    { id: 'uar-fiona', userId: 'u-fiona', authRoleId: 'builtin:FINANCE_MANAGER', createdAt: NOW },
    { id: 'uar-pat', userId: 'u-pat', authRoleId: 'builtin:PRINCIPAL', createdAt: NOW },
    { id: 'uar-tina', userId: 'u-tina', authRoleId: 'builtin:TEACHER', createdAt: NOW },
  ]);
  server = await startLiveServer();
  [fiona, pat, tina] = await Promise.all(['fiona', 'pat', 'tina'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const publish = (who: Caller, year: number, month: number) => who.call('POST', `/api/profit-sharing/publications/${year}/${month}/publish`);
const unpublish = (who: Caller, year: number, month: number, reason: string) => who.call('POST', `/api/profit-sharing/publications/${year}/${month}/unpublish`, { reason });
const tinasPools = async () => (await tina.call('GET', `/api/teachers/${TINA_TEACHER}/pay-pools?year=${PAST_YEAR}&quarter=0`)).body;
const tinasQuarter = async () => (await tinasPools()).teamPool;
const publishedFlags = (months: { published: boolean }[]) => months.map(m => m.published);

describe('Profit sharing — publishing a month', () => {
  it('lets only the Finance Manager publish or take back — not the Principal, not a teacher', async () => {
    for (const who of [pat, tina]) {
      expect((await publish(who, PAST_YEAR, 0)).status).toBe(403);
      expect((await unpublish(who, PAST_YEAR, 0, 'x')).status).toBe(403);
    }
    expect((await tina.call('GET', `/api/profit-sharing/publications?year=${PAST_YEAR}`)).status).toBe(403);
    expect(await db.select().from(profitSharePublications)).toHaveLength(0);
  });

  it('shows staff a month — team pool and annual bonus — only once it’s published, tells them, and hides it again when taken back', async () => {
    expect((await tinasQuarter()).months.map((m: { published: boolean }) => m.published)).toEqual([false, false, false]);

    const r = await publish(fiona, PAST_YEAR, 0);
    expect(r.status).toBe(200);
    expect(r.body.months[0].published).toMatchObject({ byName: 'Fiona Finance' });
    expect((await publish(fiona, PAST_YEAR, 0)).status).toBe(409); // already published
    expect((await tinasQuarter()).months.map((m: { published: boolean }) => m.published)).toEqual([true, false, false]);
    // The annual bonus follows the same publish: January only.
    expect(publishedFlags((await tinasPools()).annualBonus.months)).toEqual([true, ...Array(11).fill(false)]);

    const told = await db.select().from(notifications).where(eq(notifications.userId, 'u-tina'));
    expect(told.map(n => ({ kind: n.kind, link: n.link }))).toEqual([{ kind: 'PROFIT_SHARE_PUBLISHED', link: `/teachers/${TINA_TEACHER}/my-compensation/pools` }]);
    expect(told[0].title).toBe(`Profit sharing for January ${PAST_YEAR} is published`);

    expect((await unpublish(fiona, PAST_YEAR, 0, '   ')).status).toBe(409); // a reason is needed
    expect((await unpublish(fiona, PAST_YEAR, 0, 'Costs were entered twice')).status).toBe(200);
    expect((await tinasQuarter()).months[0].published).toBe(false);
    expect(publishedFlags((await tinasPools()).annualBonus.months).some(Boolean)).toBe(false);

    const history = (await fiona.call('GET', `/api/profit-sharing/publications?year=${PAST_YEAR}`)).body.history;
    expect(history.map((h: { action: string; reason: string | null }) => [h.action, h.reason])).toEqual([['UNPUBLISHED', 'Costs were entered twice'], ['PUBLISHED', null]]);
  });

  it('won’t publish a month that hasn’t finished', async () => {
    expect((await publish(fiona, FUTURE_YEAR, 0)).status).toBe(409);
    expect((await publish(fiona, PAST_YEAR, 12)).status).toBe(400);
  });
});
