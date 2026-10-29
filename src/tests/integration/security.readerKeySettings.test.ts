import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { readerOrStaffMiddleware } from '../../middlewares/reader.middleware.js';
import { createReaderKey, deleteReaderKey, getReaderKey } from '../../controllers/attendance-reader.controller.js';
import { getSettings, updateSetting } from '../../controllers/settings.controller.js';
import { READER_KEY_SETTING } from '../../services/readerKey.service.js';
import { resetTables } from './testDb.js';
import { req, reqWith, res, nextSpy } from './http.js';

// Settings → Attendance Reader: an admin generates the door readers' key in
// the app. Real handlers against the test database.

beforeEach(async () => {
  await resetTables(systemSettings);
  vi.stubEnv('ATTENDANCE_READER_KEY', ''); // settings-managed mode
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await pool.end();
});

async function generate() {
  const r = res();
  await createReaderKey(req(), r);
  return r.body as { key: string; status: { configured: boolean; source: string; hint: string } };
}
async function scanWith(key?: string) {
  const r = res();
  const next = nextSpy();
  await readerOrStaffMiddleware(reqWith({ headers: key ? { 'x-reader-key': key } : {} }), r, next);
  return next.called;
}

describe('Security — attendance reader key managed in Settings', () => {
  it('generates a long random key and reports protection as on', async () => {
    const { key, status } = await generate();
    expect(key).toMatch(/^kcr_[A-Za-z0-9_-]{32}$/);
    expect(status).toMatchObject({ configured: true, source: 'settings', hint: key.slice(-4) });
  });

  it('never stores the key itself — only a one-way hash', async () => {
    const { key } = await generate();
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, READER_KEY_SETTING));
    expect(JSON.stringify(row.value)).not.toContain(key);
    expect(JSON.stringify(row.value)).not.toContain(key.slice(4, -4));
  });

  it('makes the scanner accept the new key and refuse anything else', async () => {
    const { key } = await generate();
    expect(await scanWith(key)).toBe(true);
    expect(await scanWith('kcr_not-the-key')).toBe(false);
    expect(await scanWith()).toBe(false);
  });

  it('stops the old key working when a new one is generated', async () => {
    const { key: oldKey } = await generate();
    const { key: newKey } = await generate();
    expect(newKey).not.toBe(oldKey);
    expect(await scanWith(oldKey)).toBe(false);
    expect(await scanWith(newKey)).toBe(true);
  });

  it('turning the key off returns the scanner to open mode', async () => {
    await generate();
    const r = res();
    await deleteReaderKey(req(), r);
    expect(r.body).toMatchObject({ configured: false });
    expect(await scanWith()).toBe(true);
  });

  it('shows status without ever revealing the key again', async () => {
    const { key } = await generate();
    const r = res();
    await getReaderKey(req(), r);
    expect(r.body).toMatchObject({ configured: true, hint: key.slice(-4) });
    expect(JSON.stringify(r.body)).not.toContain(key);
  });

  it('keeps the stored key out of the settings every signed-in user can read', async () => {
    await generate();
    const r = res();
    await getSettings(req(), r);
    expect(Object.keys(r.body).some(k => k.startsWith('secret.'))).toBe(false);
  });

  it('refuses to overwrite the key through the general settings editor', async () => {
    const r = res();
    await updateSetting(req({ value: { hash: 'attacker-chosen' } }, { key: READER_KEY_SETTING }), r);
    expect(r.statusCode).toBe(403);
    expect((await db.select().from(systemSettings)).length).toBe(0);
  });

  it('defers to a key set in the server environment, which can\'t be changed from the page', async () => {
    vi.stubEnv('ATTENDANCE_READER_KEY', 'env-managed-key');
    const status = res();
    await getReaderKey(req(), status);
    expect(status.body).toMatchObject({ configured: true, source: 'env' });
    const gen = res();
    await createReaderKey(req(), gen);
    expect(gen.statusCode).toBe(409);
    expect(await scanWith('env-managed-key')).toBe(true);
  });
});
