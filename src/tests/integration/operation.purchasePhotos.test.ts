import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db, pool } from '../../db/client.js';
import { purchaseRequestLogs, purchaseRequests, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';
import { PURCHASE_PHOTOS_DIR } from '../../services/purchasePhotos.service.js';

// Shopping list → "Request an item" with photos (e.g. the exact product), over
// real HTTP: private files, seen only by the requester, shopping-list managers
// and Admins.

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server: LiveServer;
let tina: Caller;
let other: Caller;
let supervisor: Caller;
const created: string[] = [];

beforeAll(async () => {
  await resetTables(purchaseRequestLogs, purchaseRequests, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
    await activeUser({ id: 'u-other', email: 'other@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
    await activeUser({ id: 'u-sup', email: 'sup@kindertech.test', role: 'USER', authRoleId: 'builtin:SUPERVISOR' }),
  ]);
  server = await startLiveServer();
  [tina, other, supervisor] = await Promise.all(['tina', 'other', 'sup'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
afterAll(async () => {
  for (const f of created) fs.rmSync(path.join(PURCHASE_PHOTOS_DIR, f), { force: true }); // leave no test file behind
  await server?.close(); await pool.end();
});

function request(who: Caller, files: { data: Buffer; type: string; name: string }[]) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ item: 'Glue sticks', quantity: '2 boxes', purpose: 'Sunflower class art', buyer: 'SUPERVISOR' })) form.append(k, v);
  for (const f of files) form.append('photos', new Blob([f.data], { type: f.type }), f.name);
  return fetch(`${server.base}/api/purchase-requests`, { method: 'POST', body: form, headers: { cookie: who.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE } });
}
const open = (who: Caller, id: string, fileId: string) =>
  fetch(`${server.base}/api/purchase-requests/${id}/photos/${fileId}`, { headers: { cookie: who.cookie! } });

describe('Shopping list — photos on a request', () => {
  it('attaches photos to a request — seen by the requester and the shopping-list manager, not by other staff', async () => {
    const res = await request(tina, [{ data: PNG, type: 'image/png', name: 'the-one.png' }]);
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; photos: { id: string; name: string }[] };
    expect(body.photos).toMatchObject([{ name: 'the-one.png' }]);
    const fileId = body.photos[0].id;
    created.push(fileId);
    const stem = fileId.replace(/\.[a-z0-9]+$/i, '');
    expect((await open(tina, body.id, stem)).status).toBe(200);
    expect((await open(supervisor, body.id, stem)).status).toBe(200);
    expect((await open(other, body.id, stem)).status).toBe(403);
  });

  it('refuses a file that isn’t a photo, or more than 3 photos — and still takes a request with none', async () => {
    expect((await request(tina, [{ data: Buffer.from('%PDF-1.4'), type: 'application/pdf', name: 'quote.pdf' }])).status).toBe(400);
    const four = Array.from({ length: 4 }, (_, i) => ({ data: PNG, type: 'image/png', name: `p${i}.png` }));
    expect((await request(tina, four)).status).toBe(400);
    const none = await request(tina, []);
    expect(none.status).toBe(201);
    expect((await none.json() as { photos: unknown }).photos).toBeNull();
  });
});
