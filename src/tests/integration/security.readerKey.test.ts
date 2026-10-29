import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { db, pool } from '../../db/client.js';
import { users, systemSettings } from '../../db/schema.js';
import { readerOrStaffMiddleware } from '../../middlewares/reader.middleware.js';
import { resetTables } from './testDb.js';
import { reqWith, res, nextSpy } from './http.js';

// POST /api/attendance/scan: the RFID readers prove themselves with the
// shared X-Reader-Key; staff using the app's manual scan use their login.
// Anyone else is refused — once ATTENDANCE_READER_KEY is configured.

const KEY = 'reader-secret-7f3a9c';
const NOW = new Date('2026-01-01T00:00:00Z');
const STAFF = { id: 'staff-1', email: 'staff@kindertech.test', role: 'USER', teacherId: null };

beforeEach(async () => {
  await resetTables(users, systemSettings);
  await db.insert(users).values({
    id: STAFF.id, email: STAFF.email, name: 'Staff', passwordHash: 'x', role: 'USER',
    activated: true, createdAt: NOW, updatedAt: NOW,
  });
  vi.stubEnv('ATTENDANCE_READER_KEY', KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await pool.end();
});

async function scanAs(headers: Record<string, string>) {
  const r = res();
  const next = nextSpy();
  await readerOrStaffMiddleware(reqWith({ headers }), r, next);
  return { allowed: next.called, status: r.statusCode };
}

describe('Security — attendance scanner key', () => {
  it('lets a reader with the correct key record a scan', async () => {
    expect((await scanAs({ 'x-reader-key': KEY })).allowed).toBe(true);
  });

  it('refuses a wrong key', async () => {
    expect(await scanAs({ 'x-reader-key': 'guessed-key' })).toEqual({ allowed: false, status: 401 });
  });

  it('refuses a key that only partly matches', async () => {
    expect((await scanAs({ 'x-reader-key': KEY.slice(0, -1) })).allowed).toBe(false);
    expect((await scanAs({ 'x-reader-key': `${KEY}x` })).allowed).toBe(false);
  });

  it('refuses a caller with neither a key nor a login', async () => {
    expect(await scanAs({})).toEqual({ allowed: false, status: 401 });
  });

  it('lets signed-in staff use the app\'s manual scan without the reader key', async () => {
    const token = jwt.sign(STAFF, process.env.JWT_SECRET!, { expiresIn: '8h' });
    expect((await scanAs({ authorization: `Bearer ${token}` })).allowed).toBe(true);
  });

  it('refuses a forged login used instead of the key', async () => {
    const forged = jwt.sign(STAFF, 'an-attackers-secret');
    expect((await scanAs({ authorization: `Bearer ${forged}` })).allowed).toBe(false);
  });

  it('stays open until the key is configured, so readers keep working during roll-out', async () => {
    vi.stubEnv('ATTENDANCE_READER_KEY', '');
    expect((await scanAs({})).allowed).toBe(true);
  });
});
