import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { users, teachers, positions, authRoles, authRoleModules, authRoleViews } from '../../db/schema.js';
import { requireModule, requireView, resolveGrants } from '../../middlewares/auth.middleware.js';
import { resetTables } from './testDb.js';
import { reqWith, res, nextSpy } from './http.js';
import {
  authRoleRows, moduleRows, viewRows, positionRows, teacherRows, userRows, USER_ID,
} from '../fixtures/permissions.js';

// Module / view permissions for non-admin staff, resolved live from the
// real (test) database: User → direct access role, and/or User → Teacher →
// Position → access role. Fixtures: ../fixtures/permissions.ts.

beforeEach(async () => {
  await resetTables(users, teachers, positions, authRoleViews, authRoleModules, authRoles);
  await db.insert(authRoles).values(authRoleRows);
  await db.insert(authRoleModules).values(moduleRows);
  await db.insert(authRoleViews).values(viewRows);
  await db.insert(positions).values(positionRows);
  await db.insert(teachers).values(teacherRows);
  await db.insert(users).values(userRows);
});
afterAll(async () => {
  await pool.end();
});

/** Runs a permission middleware as the given user id + role. */
async function gate(mw: ReturnType<typeof requireModule>, userId: string, role = 'USER') {
  const r = res();
  const next = nextSpy();
  await mw(reqWith({ user: { id: userId, email: `${userId}@kindertech.test`, role } }), r, next);
  return { allowed: next.called, status: r.statusCode };
}

describe('Security — module permissions (requireModule)', () => {
  it('allows a user whose own access role has the module', async () => {
    expect((await gate(requireModule('HR'), USER_ID.office)).allowed).toBe(true);
  });

  it('allows a teacher whose position\'s access role has the module', async () => {
    expect((await gate(requireModule('OPERATION'), USER_ID.teacher)).allowed).toBe(true);
  });

  it('refuses a module the user\'s access role does not have, with 403', async () => {
    const r = await gate(requireModule('FINANCE'), USER_ID.office);
    expect(r).toEqual({ allowed: false, status: 403 });
  });

  it('refuses a user with no access role at all', async () => {
    expect(await gate(requireModule('HR'), USER_ID.nobody)).toEqual({ allowed: false, status: 403 });
  });

  it('combines a direct role and a position role rather than one replacing the other', async () => {
    expect((await gate(requireModule('HR'), USER_ID.both)).allowed).toBe(true);        // from direct role
    expect((await gate(requireModule('OPERATION'), USER_ID.both)).allowed).toBe(true); // from position
  });

  it('refuses a user who no longer exists', async () => {
    expect((await gate(requireModule('HR'), 'deleted-user')).allowed).toBe(false);
  });

  it('lets Admins and Superadmins through without any access role', async () => {
    expect((await gate(requireModule('FINANCE'), USER_ID.nobody, 'ADMIN')).allowed).toBe(true);
    expect((await gate(requireModule('FINANCE'), USER_ID.nobody, 'SUPERADMIN')).allowed).toBe(true);
  });

  it('takes effect immediately when a module is revoked — no re-login needed', async () => {
    expect((await gate(requireModule('HR'), USER_ID.office)).allowed).toBe(true);
    await db.delete(authRoleModules).where(eq(authRoleModules.module, 'HR'));
    expect((await gate(requireModule('HR'), USER_ID.office)).allowed).toBe(false);
  });

  it('takes effect immediately when a teacher moves to a position without access', async () => {
    await db.update(teachers).set({ positionId: 'P-NONE' }).where(eq(teachers.id, 't-1'));
    expect((await gate(requireModule('OPERATION'), USER_ID.teacher)).allowed).toBe(false);
  });
});

describe('Security — view permissions (requireView)', () => {
  it('allows a user whose access role has the view', async () => {
    expect((await gate(requireView('OPERATION_SOP_APPROVE'), USER_ID.teacher)).allowed).toBe(true);
  });

  it('refuses a user whose role has the module but not the specific view', async () => {
    // Office staff have the HR module but not the SOP-approval view.
    expect(await gate(requireView('OPERATION_SOP_APPROVE'), USER_ID.office)).toEqual({ allowed: false, status: 403 });
  });

  it('does not treat having a module as having every view in it', async () => {
    const { views } = await resolveGrants(USER_ID.office);
    expect(views.size).toBe(0);
  });

  it('lets Admins through without the view', async () => {
    expect((await gate(requireView('OPERATION_SOP_APPROVE'), USER_ID.nobody, 'ADMIN')).allowed).toBe(true);
  });
});
