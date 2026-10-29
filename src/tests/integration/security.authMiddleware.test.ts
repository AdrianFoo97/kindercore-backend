import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { authMiddleware, adminMiddleware } from '../../middlewares/auth.middleware.js';
import { resetTables } from './testDb.js';
import { reqWith, res, nextSpy } from './http.js';

// The gatekeepers in front of every protected endpoint. authMiddleware
// decides "is this a genuine signed-in user, whose account is still
// active?" — checking the login token AND re-reading the account from the
// (test) database; adminMiddleware decides "is that user an admin?".

const SECRET = process.env.JWT_SECRET!;
const NOW = new Date('2026-01-01T00:00:00Z');
const USER = { id: 'user-1', email: 'teacher@kindertech.test', role: 'USER', teacherId: null };
const ADMIN = { id: 'admin-1', email: 'boss@kindertech.test', role: 'ADMIN', teacherId: null };
const sign = (payload: object, secret = SECRET, opts: jwt.SignOptions = { expiresIn: '8h' }) => jwt.sign(payload, secret, opts);

const account = (u: typeof USER, extra: Partial<typeof users.$inferInsert> = {}): typeof users.$inferInsert => ({
  id: u.id, email: u.email, name: u.id, passwordHash: 'x', role: u.role as 'USER' | 'ADMIN',
  activated: true, teacherId: null, createdAt: NOW, updatedAt: NOW, ...extra,
});

beforeEach(async () => {
  await resetTables(users);
  await db.insert(users).values([account(USER), account(ADMIN)]);
});
afterAll(async () => {
  await pool.end();
});

/** Runs authMiddleware with the given Authorization header. */
async function runAuth(authorization?: string) {
  const r = res();
  const next = nextSpy();
  const request = reqWith({ headers: authorization === undefined ? {} : { authorization } });
  await authMiddleware(request, r, next);
  return { r, next, request };
}

describe('Security — sign-in check (authMiddleware)', () => {
  it('lets a request with a valid login token through, as that user', async () => {
    const { next, request } = await runAuth(`Bearer ${sign(USER)}`);
    expect(next.called).toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1', role: 'USER' });
  });

  it('refuses a request with no token', async () => {
    const { r, next } = await runAuth();
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses a token not sent as "Bearer …"', async () => {
    const { r, next } = await runAuth(sign(USER));
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses garbage instead of a token', async () => {
    const { r, next } = await runAuth('Bearer not.a.token');
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses a token signed with someone else\'s secret', async () => {
    const { r, next } = await runAuth(`Bearer ${sign(USER, 'an-attackers-secret')}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses an expired token', async () => {
    const expired = sign({ ...USER, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {});
    const { r, next } = await runAuth(`Bearer ${expired}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses a token whose contents were edited to claim admin', async () => {
    // Take a genuine USER token and swap its payload for one saying ADMIN,
    // keeping the original signature — the classic privilege-escalation try.
    const [header, , signature] = sign(USER).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...USER, role: 'ADMIN' })).toString('base64url');
    const { r, next } = await runAuth(`Bearer ${header}.${forgedPayload}.${signature}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses an unsigned token (algorithm "none")', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...USER, role: 'SUPERADMIN' })}.`;
    const { r, next } = await runAuth(`Bearer ${unsigned}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses a still-valid token once the account has been deleted', async () => {
    const token = sign(USER);
    await db.delete(users).where(eq(users.id, USER.id));
    const { r, next } = await runAuth(`Bearer ${token}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('refuses a still-valid token once the account has been deactivated', async () => {
    const token = sign(USER);
    await db.update(users).set({ activated: false }).where(eq(users.id, USER.id));
    const { r, next } = await runAuth(`Bearer ${token}`);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('uses the account\'s current role, not the role written in the token', async () => {
    // Signed in as Admin, then demoted — the old token must lose admin power at once.
    const token = sign(ADMIN);
    await db.update(users).set({ role: 'USER' }).where(eq(users.id, ADMIN.id));
    const { request, next } = await runAuth(`Bearer ${token}`);
    expect(next.called).toBe(true);
    expect(request.user?.role).toBe('USER');

    const r = res();
    const adminNext = nextSpy();
    adminMiddleware(request, r, adminNext);
    expect(adminNext.called).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it('uses the account\'s current teacher link, not the one in the token', async () => {
    const token = sign(USER);
    await db.update(users).set({ teacherId: 't-new' }).where(eq(users.id, USER.id));
    const { request } = await runAuth(`Bearer ${token}`);
    expect(request.user?.teacherId).toBe('t-new');
  });
});

describe('Security — admin check (adminMiddleware)', () => {
  const runAdmin = (role?: string) => {
    const r = res();
    const next = nextSpy();
    adminMiddleware(reqWith({ user: role ? { ...USER, role } : undefined }), r, next);
    return { r, next };
  };

  it('lets an Admin through', () => {
    expect(runAdmin('ADMIN').next.called).toBe(true);
  });

  it('lets a Superadmin through', () => {
    expect(runAdmin('SUPERADMIN').next.called).toBe(true);
  });

  it('refuses a regular user with 403', () => {
    const { r, next } = runAdmin('USER');
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it('refuses a request that never signed in', () => {
    const { r, next } = runAdmin(undefined);
    expect(next.called).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it('does not accept look-alike roles', () => {
    for (const role of ['admin', 'Admin', 'ADMIN ', 'SUPER_ADMIN']) {
      expect(runAdmin(role).next.called, role).toBe(false);
    }
  });
});
