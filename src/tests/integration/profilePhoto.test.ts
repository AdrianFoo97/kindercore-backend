import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { storedImages, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';

// My Profile → your own photo, over real HTTP: set it, see it, change it,
// remove it — always only your own (the address has no user id).

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server: LiveServer;
let tina: Caller;
let other: Caller;

beforeAll(async () => {
  await resetTables(storedImages, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
    await activeUser({ id: 'u-other', email: 'other@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
  ]);
  server = await startLiveServer();
  [tina, other] = await Promise.all(['tina', 'other'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const put = (who: Caller, data: Buffer, type: string) => {
  const form = new FormData();
  form.append('photo', new Blob([data], { type }), 'me.png');
  return fetch(`${server.base}/api/auth/me/photo`, { method: 'PUT', body: form, headers: { cookie: who.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE } });
};
const get = (who: Caller) => fetch(`${server.base}/api/auth/me/photo`, { headers: { cookie: who.cookie! } });

describe('My Profile — your own photo', () => {
  it('sets, shows and removes your own photo — a colleague still has none, and a replaced photo isn’t kept', async () => {
    expect((await get(tina)).status).toBe(404);
    expect((await put(tina, PNG, 'image/png')).status).toBe(200);
    const mine = await get(tina);
    expect(mine.status).toBe(200);
    expect(Buffer.from(await mine.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await get(other)).status).toBe(404);

    expect((await put(tina, PNG, 'image/png')).status).toBe(200); // replace
    expect(await db.select().from(storedImages)).toHaveLength(1);

    expect((await tina.call('DELETE', '/api/auth/me/photo')).status).toBe(200);
    expect((await get(tina)).status).toBe(404);
    expect(await db.select().from(storedImages)).toHaveLength(0);
  });

  it('sets your display name — shown at sign-in — and blank (or your full name) goes back to the full name', async () => {
    const set = await tina.call('PUT', '/api/auth/me/display-name', { displayName: '  Teacher   Tina ' });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ displayName: 'Teacher Tina' });
    const again = await fetch(`${server.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tina@kindertech.test', password: PASSWORD }) });
    expect((await again.json() as { user: { displayName: string | null } }).user.displayName).toBe('Teacher Tina');
    expect((await tina.call('PUT', '/api/auth/me/display-name', { displayName: '' })).body).toEqual({ displayName: null });
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, 'u-tina'));
    expect((await tina.call('PUT', '/api/auth/me/display-name', { displayName: me.name })).body).toEqual({ displayName: null });
    expect((await tina.call('PUT', '/api/auth/me/display-name', { displayName: 'x'.repeat(61) })).status).toBe(400);
  });

  it('only takes a photo, and only from someone signed in', async () => {
    expect((await put(tina, Buffer.from('%PDF-1.4'), 'application/pdf')).status).toBe(400);
    expect((await fetch(`${server.base}/api/auth/me/photo`)).status).toBe(401);
  });
});
