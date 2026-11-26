import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { authRoleModules, authRoleViews, authRoles, positions, userAuthRoles, users } from '../../db/schema.js';
import {
  createAuthRole, deleteAuthRole, listAuthRoles, setAuthRoleModules, setAuthRoleViews, updateAuthRole,
} from '../../controllers/auth-roles.controller.js';
import { setUserAuthRoles } from '../../controllers/auth.controller.js';
import { resolveGrants } from '../../middlewares/auth.middleware.js';
import { resetTables } from './testDb.js';
import { req, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Settings → Access roles: built-in roles (defined in code) + the centre's own.
// Real handlers and grant resolution against the test database.

const NOW = new Date('2026-01-01T00:00:00Z');

beforeEach(async () => {
  await resetTables(users, userAuthRoles, authRoleModules, authRoleViews, authRoles, positions);
});
afterAll(async () => {
  await pool.end();
});

const call = async (fn: (q: any, r: any) => Promise<void>, body: unknown = {}, params: Record<string, string> = {}) => {
  const r = res(); await fn(req(body, params), r); return r;
};

describe('Access roles — built-in and your own', () => {
  it('lists the built-in roles with their modules, functions and who uses them, then your own', async () => {
    await db.insert(users).values(await activeUser({ id: 'u-sup', email: 'sup@kindertech.test', role: 'USER', authRoleId: 'builtin:SUPERVISOR' }));
    await call(createAuthRole, { name: 'Admissions Lead' });
    const list = (await call(listAuthRoles)).body as any[];
    const sup = list.find(r => r.id === 'builtin:SUPERVISOR');
    expect(sup).toMatchObject({ builtIn: true, area: 'Operation', modules: ['OPERATION'], peopleCount: 1 });
    expect(sup.views).toContain('OPERATION_SOP_APPROVE');
    expect(list.at(-1)).toMatchObject({ name: 'Admissions Lead', builtIn: false });
  });

  it('gives someone with a built-in role exactly that role’s modules and functions', async () => {
    await db.insert(users).values(await activeUser({ id: 'u-dir', email: 'dir@kindertech.test', role: 'USER', authRoleId: 'builtin:HR_DIRECTOR' }));
    const g = await resolveGrants('u-dir');
    expect([...g.modules]).toEqual(['HR']);
    expect([...g.views].sort()).toEqual(['HR_SEE_ALL_STAFF', 'HR_SEE_PAY']);
  });

  it('refuses to change or delete a built-in role', async () => {
    for (const [fn, body] of [[updateAuthRole, { name: 'x' }], [setAuthRoleModules, { modules: ['HR'] }], [setAuthRoleViews, { views: [] }], [deleteAuthRole, {}]] as const) {
      const r = await call(fn as any, body, { id: 'builtin:TEACHER' });
      expect(r.statusCode).toBe(400);
      expect(r.body.message).toMatch(/Built-in roles can’t be changed/);
    }
  });

  it('lets you build your own role from modules and functions, refusing functions the app doesn’t check', async () => {
    const role = (await call(createAuthRole, { name: 'Office Admin' })).body;
    expect((await call(setAuthRoleModules, { modules: ['OPERATION'] }, { id: role.id })).statusCode).toBe(200);
    expect((await call(setAuthRoleViews, { views: ['OPERATION_FACILITY_MANAGE'] }, { id: role.id })).statusCode).toBe(200);
    expect((await call(setAuthRoleViews, { views: ['MADE_UP'] }, { id: role.id })).statusCode).toBe(400);
    await db.insert(users).values(await activeUser({ id: 'u-oa', email: 'oa@kindertech.test', role: 'USER', authRoleId: role.id }));
    const g = await resolveGrants('u-oa');
    expect([...g.modules]).toEqual(['OPERATION']);
    expect([...g.views]).toEqual(['OPERATION_FACILITY_MANAGE']);
  });

  it('won’t delete a role someone still has', async () => {
    const role = (await call(createAuthRole, { name: 'Office Admin' })).body;
    await db.insert(users).values(await activeUser({ id: 'u-oa', email: 'oa@kindertech.test', role: 'USER', authRoleId: role.id }));
    expect((await call(deleteAuthRole, {}, { id: role.id })).statusCode).toBe(409);
  });

  it('only gives people a role that exists — built-in or your own', async () => {
    await db.insert(users).values(await activeUser({ id: 'u-x', email: 'x@kindertech.test', role: 'USER' }));
    expect((await call(setUserAuthRoles, { authRoleIds: ['builtin:NOPE'] }, { id: 'u-x' })).statusCode).toBe(400);
    expect((await call(setUserAuthRoles, { authRoleIds: ['made-up-id'] }, { id: 'u-x' })).statusCode).toBe(400);
    expect((await call(setUserAuthRoles, { authRoleIds: ['builtin:ANALYST'] }, { id: 'u-x' })).statusCode).toBe(200);
    expect((await resolveGrants('u-x')).modules.has('ANALYSIS')).toBe(true);
  });

  it('lets one person hold several roles and gives them everything those roles allow', async () => {
    await db.insert(users).values(await activeUser({ id: 'u-p', email: 'p@kindertech.test', role: 'USER' }));
    expect((await call(setUserAuthRoles, { authRoleIds: ['builtin:HR_DIRECTOR', 'builtin:FINANCE_MANAGER'] }, { id: 'u-p' })).statusCode).toBe(200);
    const g = await resolveGrants('u-p');
    expect([...g.modules].sort()).toEqual(['ANALYSIS', 'FINANCE', 'HR']);
    expect([...g.views].sort()).toEqual(['ANALYSIS_PROFIT_PUBLISH', 'HR_SEE_ALL_STAFF', 'HR_SEE_PAY']);
    // Taking one role off keeps the other; [] removes them all.
    await call(setUserAuthRoles, { authRoleIds: ['builtin:FINANCE_MANAGER'] }, { id: 'u-p' });
    expect((await resolveGrants('u-p')).modules.has('HR')).toBe(false);
    await call(setUserAuthRoles, { authRoleIds: [] }, { id: 'u-p' });
    expect((await resolveGrants('u-p')).modules.size).toBe(0);
  });

  it('counts a role as in use while anyone holds it, among their other roles', async () => {
    const role = (await call(createAuthRole, { name: 'Office Admin' })).body;
    await db.insert(users).values(await activeUser({ id: 'u-p', email: 'p@kindertech.test', role: 'USER' }));
    await call(setUserAuthRoles, { authRoleIds: ['builtin:ANALYST', role.id] }, { id: 'u-p' });
    expect((await call(deleteAuthRole, {}, { id: role.id })).statusCode).toBe(409);
    const list = (await call(listAuthRoles)).body as any[];
    expect(list.find(r => r.id === 'builtin:ANALYST').peopleCount).toBe(1);
  });
});
