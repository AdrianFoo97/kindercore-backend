import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { sopSteps, sopTemplateRevisions, sopTemplates, storedImages, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';
import { saveImage } from '../../services/storedImage.service.js';

// How-To Guides → a photo on each step (shown on the guide and its poster).
// Over real HTTP: a teacher adds a photo while suggesting a change, it
// survives approval onto the live step, and only real step photos are taken.

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = new Date('2026-01-01T00:00:00Z');

let server: LiveServer;
let teacher: Caller;
let supervisor: Caller;

beforeAll(async () => {
  await resetTables(sopSteps, sopTemplateRevisions, sopTemplates, storedImages, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
    await activeUser({ id: 'u-sup', email: 'sup@kindertech.test', role: 'USER', authRoleId: 'builtin:SUPERVISOR' }),
  ]);
  await db.insert(sopTemplates).values({ id: 'g-wash', title: 'Hand washing', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopSteps).values({ id: 's-wet', sopTemplateId: 'g-wash', section: 'Main', title: 'Wet hands', displayOrder: 0, createdAt: NOW, updatedAt: NOW });
  server = await startLiveServer();
  [teacher, supervisor] = await Promise.all(['tina', 'sup'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

function upload(who: Caller, data: Buffer, type: string, name: string) {
  const form = new FormData();
  form.append('image', new Blob([data], { type }), name);
  return fetch(`${server.base}/api/sop-steps/images`, { method: 'POST', body: form, headers: { cookie: who.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE } });
}

describe('How-To Guides — step photos', () => {
  it('a teacher adds a photo while suggesting a change — it reaches the live step once approved, and staff can open it', async () => {
    const res = await upload(teacher, PNG, 'image/png', 'sink.png');
    expect(res.status).toBe(201);
    const { id: imageId } = await res.json() as { id: string };

    const proposed = await teacher.call('POST', '/api/sop-revisions', {
      sopTemplateId: 'g-wash', title: 'Hand washing', improvementReasons: ['Show the sink'],
      steps: [{ section: 'Main', title: 'Wet hands', detail: null, linkedTemplateId: null, imageId }],
    });
    expect(proposed.status).toBe(200);
    expect(proposed.body.stepsJson[0].imageId).toBe(imageId);

    expect((await supervisor.call('POST', `/api/sop-revisions/${proposed.body.id}/trial`, {})).status).toBe(200);
    expect((await supervisor.call('POST', `/api/sop-revisions/${proposed.body.id}/approve`, {})).status).toBe(200);
    const steps = (await supervisor.call('GET', '/api/sop-steps?sopTemplateId=g-wash')).body as { title: string; imageId: string | null }[];
    expect(steps.map(s => [s.title, s.imageId])).toEqual([['Wet hands', imageId]]);

    const photo = await fetch(`${server.base}/api/sop-steps/images/${imageId}`, { headers: { cookie: teacher.cookie! } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await photo.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await fetch(`${server.base}/api/sop-steps/images/${imageId}`)).status).toBe(401);
  });

  it('only takes real step photos — not a PDF, not an unknown id, not another kind of stored image', async () => {
    expect((await upload(teacher, Buffer.from('%PDF-1.4'), 'application/pdf', 'steps.pdf')).status).toBe(400);
    const badge = await saveImage('badge', 'image/png', PNG);
    for (const imageId of ['00000000-0000-4000-8000-000000000000', badge]) {
      const res = await teacher.call('POST', '/api/sop-revisions', {
        sopTemplateId: null, title: 'Nap time', steps: [{ section: 'Main', title: 'Lights off', imageId }],
      });
      expect(res.status).toBe(400);
    }
    const [live] = (await supervisor.call('GET', '/api/sop-steps?sopTemplateId=g-wash')).body as { id: string }[];
    const direct = await supervisor.call('PATCH', `/api/sop-steps/${live.id}`, { imageId: badge });
    expect(direct.status).toBe(400);
    expect((await fetch(`${server.base}/api/sop-steps/images/${badge}`, { headers: { cookie: teacher.cookie! } })).status).toBe(404);
  });
});
