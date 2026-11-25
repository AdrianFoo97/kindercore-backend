import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db, pool } from '../../db/client.js';
import { userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';
import { UPLOAD_ROOT } from '../../routes/upload.routes.js';

// Report a Bug → attach screenshots or a short screen recording, over real HTTP.

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const BUG_DIR = path.join(UPLOAD_ROOT, 'bug-reports');

let server: LiveServer;
let tina: Caller;
const created: string[] = [];

beforeAll(async () => {
  await resetTables(userAuthRoles, users);
  await db.insert(users).values(await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }));
  server = await startLiveServer();
  tina = await signIn(server.base, 'tina@kindertech.test', PASSWORD);
}, 120_000);
afterAll(async () => {
  for (const f of created) fs.rmSync(path.join(BUG_DIR, f), { force: true }); // leave no test file behind
  await server?.close(); await pool.end();
});

function upload(files: { data: Buffer; type: string; name: string }[]) {
  const form = new FormData();
  for (const f of files) form.append('photos', new Blob([f.data], { type: f.type }), f.name);
  return fetch(`${server.base}/api/upload/bug-report-photos`, { method: 'POST', body: form, headers: { cookie: tina.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE } });
}

describe('Report a Bug — photos and videos', () => {
  it('takes a screenshot and a short screen recording together', async () => {
    const res = await upload([
      { data: PNG, type: 'image/png', name: 'screen.png' },
      { data: Buffer.from('fake-mp4-bytes'), type: 'video/mp4', name: 'recording.mp4' },
    ]);
    expect(res.status).toBe(200);
    const { urls } = await res.json() as { urls: string[] };
    created.push(...urls.map(u => path.basename(u)));
    expect(urls.map(u => path.extname(u))).toEqual(['.png', '.mp4']);
  });

  it('refuses other files, and a photo over 5 MB (videos may be bigger) — keeping nothing it refused', async () => {
    expect((await upload([{ data: Buffer.from('%PDF-1.4'), type: 'application/pdf', name: 'log.pdf' }])).status).toBe(400);
    const before = fs.readdirSync(BUG_DIR).length;
    const big = await upload([{ data: Buffer.alloc(6 * 1024 * 1024), type: 'image/png', name: 'huge.png' }]);
    expect(big.status).toBe(400);
    expect((await big.json() as { message: string }).message).toMatch(/under 5 MB/);
    await new Promise(r => setTimeout(r, 200)); // the refused file is removed in the background
    expect(fs.readdirSync(BUG_DIR).length).toBe(before);
  });
});
