import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { featureRequests, notifications, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Request a feature, over real HTTP: any staff member sends an idea, they only
// get a "sent" reply, and admins read and review the list.

let server: LiveServer;
let tina: Caller;
let admin: Caller;

beforeAll(async () => {
  await resetTables(notifications, featureRequests, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', name: 'Tina Teacher', role: 'USER', authRoleId: 'builtin:TEACHER' }),
    await activeUser({ id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' }),
  ]);
  server = await startLiveServer();
  [tina, admin] = await Promise.all(['tina', 'admin'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
beforeEach(async () => { await resetTables(notifications, featureRequests); });
afterAll(async () => { await server?.close(); await pool.end(); });

const send = (body: Record<string, unknown>) => tina.call('POST', '/api/feature-requests', body);

describe('Tools — feature requests', () => {
  it('saves a staff member’s idea, tidied, with who sent it — and only tells them it was sent', async () => {
    const r = await send({ title: '  Dark mode ', message: ' A darker look for evening planning. ', pageUrl: '/teachers/t1/home', appVersion: '1.212.0' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const [row] = await db.select().from(featureRequests);
    expect(row).toMatchObject({ title: 'Dark mode', message: 'A darker look for evening planning.', requestedByUserId: 'u-tina', requestedByName: 'Tina Teacher', status: 'NEW', pageUrl: '/teachers/t1/home' });
  });

  it('needs both a title and what it should do', async () => {
    expect((await send({ message: 'Something new' })).status).toBe(400);
    expect((await send({ title: '   ', message: 'Something new' })).status).toBe(400);
    expect((await send({ title: 'Dark mode', message: '  ' })).status).toBe(400);
    expect(await db.select().from(featureRequests)).toHaveLength(0);
  });

  it('tells admins, who see the list and mark one reviewed — the sender can’t see or review the list', async () => {
    await send({ title: 'Dark mode', message: 'A darker look.' });
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, 'u-admin'));
    expect(inbox.map(n => ({ kind: n.kind, title: n.title, link: n.link }))).toEqual([{ kind: 'FEATURE_REQUESTED', title: 'Feature requested: Dark mode', link: '/tools/feature-requests' }]);

    expect((await tina.call('GET', '/api/feature-requests')).status).toBe(403);
    const list = await admin.call('GET', '/api/feature-requests');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    const id = list.body[0].id as string;
    expect((await tina.call('POST', `/api/feature-requests/${id}/review`)).status).toBe(403);
    const reviewed = await admin.call('POST', `/api/feature-requests/${id}/review`);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe('REVIEWED');
    expect((await admin.call('POST', '/api/feature-requests/no-such/review')).status).toBe(404);
  });
});
