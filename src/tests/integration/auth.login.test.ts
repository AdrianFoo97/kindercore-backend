import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { teachers, users } from '../../db/schema.js';
import { login, logout, activateAccount } from '../../controllers/auth.controller.js';
import { SESSION_COOKIE } from '../../services/session.service.js';
import { malaysiaDate } from '../../services/staffAccess.service.js';
import { resetTables } from './testDb.js';
import { req, res } from './http.js';
import { PASSWORD, activeUser, pendingInvite } from '../fixtures/users.js';

// The real login + account-activation handlers, against the real (test)
// MySQL database with test accounts from ../fixtures/users.ts. Replaces an
// older test that only exercised the bcrypt library itself.

const ADMIN_EMAIL = 'admin@kindertech.test';

beforeEach(async () => {
  await resetTables(users);
  await db.insert(users).values([await activeUser(), pendingInvite()]);
});
afterAll(async () => {
  await pool.end();
});

describe('Login', () => {
  it('logs in with the correct email and password', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: PASSWORD }), r);

    expect(r.statusCode).toBe(200);
    expect(r.body.user).toEqual({
      id: 'user-admin', email: ADMIN_EMAIL, name: 'Ada Admin', displayName: null, role: 'ADMIN', teacherId: null,
    });
  });

  it('signs in with a signed session cookie scripts can\'t read, carrying the user\'s id, role and teacher link, valid for 8 hours', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: PASSWORD }), r);

    const cookie = r.cookies[SESSION_COOKIE];
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 });
    const claims = jwt.verify(cookie.value, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(claims).toMatchObject({ id: 'user-admin', email: ADMIN_EMAIL, role: 'ADMIN', teacherId: null });
    expect(claims.exp! - claims.iat!).toBe(8 * 60 * 60);
    // The page's scripts never see the session: it isn't in the response body.
    expect(r.body.token).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain(cookie.value);
  });

  it('signs out by clearing the session cookie', async () => {
    const r = res();
    await logout(req(), r);
    expect(r.statusCode).toBe(204);
    expect(r.cookies[SESSION_COOKIE]).toMatchObject({ cleared: true, options: { httpOnly: true, path: '/' } });
  });

  it('never sends the password hash back to the browser', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: PASSWORD }), r);

    expect(JSON.stringify(r.body)).not.toContain('passwordHash');
    expect(JSON.stringify(r.body)).not.toContain('$2');
  });

  it('rejects a wrong password', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: 'Wrong-Password-1' }), r);

    expect(r.statusCode).toBe(401);
    expect(r.cookies[SESSION_COOKIE]).toBeUndefined();
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    // Identical responses, so the login form can't be used to discover
    // which email addresses have accounts.
    const wrongPw = res();
    await login(req({ email: ADMIN_EMAIL, password: 'Wrong-Password-1' }), wrongPw);
    const unknown = res();
    await login(req({ email: 'nobody@kindertech.test', password: PASSWORD }), unknown);

    expect(unknown.statusCode).toBe(401);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it('matches the email regardless of letter case', async () => {
    const r = res();
    await login(req({ email: 'Admin@KinderTech.TEST', password: PASSWORD }), r);

    expect(r.statusCode).toBe(200);
    expect(r.body.user.id).toBe('user-admin');
  });

  it('treats the password as case-sensitive', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: PASSWORD.toLowerCase() }), r);

    expect(r.statusCode).toBe(401);
  });

  it('refuses an invited account that has not set a password yet', async () => {
    // Pending invites are stored with an empty passwordHash — no password,
    // not even an empty one, may log into them.
    for (const password of ['', 'anything-at-all']) {
      const r = res();
      await login(req({ email: 'new.teacher@kindertech.test', password }), r);
      expect(r.statusCode).not.toBe(200);
      expect(r.cookies[SESSION_COOKIE]).toBeUndefined();
    }
  });

  it('answers a malformed email as a wrong email or password, not an error', async () => {
    const r = res();
    await login(req({ email: 'not-an-email', password: PASSWORD }), r);

    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ message: 'Invalid credentials' });
  });

  it('answers a too-short password as a wrong password, not an error', async () => {
    const r = res();
    await login(req({ email: ADMIN_EMAIL, password: 'short' }), r);

    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ message: 'Invalid credentials' });
  });

  it('rejects an empty submission', async () => {
    const r = res();
    await login(req({}), r);

    expect(r.statusCode).toBe(400);
  });

  it('records when the user signed in, for the Team Members page', async () => {
    const before = Date.now();
    await login(req({ email: ADMIN_EMAIL, password: PASSWORD }), res());
    const [u] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL));
    expect(u.lastLoginAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(u.lastSeenAt?.getTime()).toBe(u.lastLoginAt?.getTime());
  });

  it('does not record a sign-in for a wrong password', async () => {
    await login(req({ email: ADMIN_EMAIL, password: 'wrong-password' }), res());
    const [u] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL));
    expect(u.lastLoginAt).toBeNull();
  });
});

describe('Login — staff who have left', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const STAFF_EMAIL = 'leaving@kindertech.test';
  /** A teacher account whose staff record has the given Last Working Day. */
  const staffWithLastDay = async (resignedAt: Date | null) => {
    await resetTables(teachers);
    await db.insert(teachers).values({ id: 't-leaving', name: 'Lia Leaving', color: '#7c3aed', resignedAt, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(users).values(await activeUser({ id: 'user-leaving', email: STAFF_EMAIL, name: 'Lia Leaving', role: 'USER', teacherId: 't-leaving' }));
  };
  const signIn = async () => {
    const r = res();
    await login(req({ email: STAFF_EMAIL, password: PASSWORD }), r);
    return r;
  };

  it('refuses to sign in someone whose last working day has passed, saying why', async () => {
    await staffWithLastDay(new Date(Date.now() - 2 * DAY_MS));
    const r = await signIn();
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ code: 'STAFF_LEFT' });
    expect(r.body.message).toMatch(/last working day was/);
    expect(r.cookies[SESSION_COOKIE]).toBeUndefined();
    const [u] = await db.select().from(users).where(eq(users.email, STAFF_EMAIL));
    expect(u.lastLoginAt).toBeNull();
  });

  it('still signs in someone whose last working day is today or still ahead', async () => {
    await staffWithLastDay(new Date(`${malaysiaDate(new Date())}T00:00:00Z`));
    expect((await signIn()).statusCode).toBe(200);
    await resetTables(users);
    await staffWithLastDay(new Date(Date.now() + 7 * DAY_MS));
    expect((await signIn()).statusCode).toBe(200);
  });

  it('gives a wrong password the usual answer, even for someone who has left', async () => {
    await staffWithLastDay(new Date(Date.now() - 2 * DAY_MS));
    const r = res();
    await login(req({ email: STAFF_EMAIL, password: 'Wrong-Password-1' }), r);
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ message: 'Invalid credentials' });
  });
});

describe('Account activation (setting a password from an invite)', () => {
  it('stores the new password hashed, never as plain text', async () => {
    const r = res();
    await activateAccount(req({ token: 'invite-token-123', name: 'Nina Teacher', password: 'Brand-New-Pass1' }), r);
    expect(r.statusCode).toBe(200);
    // Signed straight in — by cookie, never a token in the body.
    expect(r.cookies[SESSION_COOKIE]?.options).toMatchObject({ httpOnly: true });
    expect(r.body.token).toBeUndefined();

    const [row] = await db.select().from(users).where(eq(users.id, 'user-pending'));
    expect(row.passwordHash).not.toBe('Brand-New-Pass1');
    expect(await bcrypt.compare('Brand-New-Pass1', row.passwordHash)).toBe(true);
    expect(row.activated).toBe(true);
    expect(row.inviteToken).toBeNull();
  });

  it('lets the new account log in with the password chosen at activation', async () => {
    await activateAccount(req({ token: 'invite-token-123', name: 'Nina Teacher', password: 'Brand-New-Pass1' }), res());

    const r = res();
    await login(req({ email: 'new.teacher@kindertech.test', password: 'Brand-New-Pass1' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.user.name).toBe('Nina Teacher');
  });

  it('cannot be used twice with the same invite link', async () => {
    await activateAccount(req({ token: 'invite-token-123', name: 'Nina Teacher', password: 'Brand-New-Pass1' }), res());

    const again = res();
    await activateAccount(req({ token: 'invite-token-123', name: 'Someone Else', password: 'Hijack-Attempt1' }), again);
    expect(again.statusCode).not.toBe(200);
  });

  it('refuses an expired invite link', async () => {
    await resetTables(users);
    await db.insert(users).values(pendingInvite({ inviteExpiresAt: new Date(Date.now() - 60_000) }));

    const r = res();
    await activateAccount(req({ token: 'invite-token-123', name: 'Nina Teacher', password: 'Brand-New-Pass1' }), r);
    expect(r.statusCode).toBe(410);
  });

  it('refuses a password shorter than 8 characters', async () => {
    const r = res();
    await activateAccount(req({ token: 'invite-token-123', name: 'Nina Teacher', password: 'short' }), r);
    expect(r.statusCode).toBe(400);

    const [row] = await db.select().from(users).where(eq(users.id, 'user-pending'));
    expect(row.activated).toBe(false);
  });
});
