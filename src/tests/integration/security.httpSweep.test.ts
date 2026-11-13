import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { authRoleModules, authRoles, authRoleViews, positions, teachers, users } from '../../db/schema.js';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';
import { APPROVED_ANY_SIGNED_IN, APPROVED_PUBLIC } from '../securityPolicy.js';
import { resetTables } from './testDb.js';
import { anonymous, signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { OWNER_TEACHER_ID, PERSONA_PASSWORD, PERSONAS, personaRows } from '../fixtures/personas.js';

// Deny by default, proven over real HTTP. Every API route in the backend
// (from the generated route map) is called on the running app:
//   • by nobody — it must answer 401, unless it's an approved public endpoint;
//   • by a plain teacher with no modules, aimed at a COLLEAGUE's record — it
//     must answer 403, unless it's approved for every signed-in person.
// The static checks read the route files; this proves the server actually
// refuses — catching wrong middleware order, shadowed routes or a broken
// permission lookup. A route that should refuse but doesn't fails here.

const MIN_ROUTES = 200; // guards against a vacuous pass if the route map ever came back empty

const endpoints = ARCHITECTURE.routeGroups.flatMap(g => g.endpoints);
const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
/** Fill route parameters: a colleague's teacher id, otherwise a made-up id. */
const fill = (path: string) => path.replace(/:(\w+)/g, (_m, name: string) => (name === 'teacherId' ? OWNER_TEACHER_ID : 'probe-id'));

/** Every route that answers the caller differently from `expected`. */
async function sweep(caller: Caller, routes: typeof endpoints, expected: number): Promise<string[]> {
  const wrong: string[] = [];
  for (const e of routes) {
    const { status } = await caller.call(e.method, fill(e.path));
    if (status !== expected) wrong.push(`${key(e)} → ${status}`);
  }
  return wrong;
}

let server: LiveServer;
beforeAll(async () => {
  await resetTables(users, teachers, positions, authRoleViews, authRoleModules, authRoles);
  const rows = await personaRows();
  await db.insert(authRoles).values(rows.authRoles);
  await db.insert(authRoleModules).values(rows.authRoleModules);
  await db.insert(positions).values(rows.positions);
  await db.insert(teachers).values(rows.teachers);
  await db.insert(users).values(rows.users);
  server = await startLiveServer();
}, 30_000);
afterAll(async () => {
  await server?.close();
  await pool.end();
});

describe('Security — every route refuses the wrong person (live HTTP)', () => {
  it('refuses every non-public route to someone who isn\'t signed in', async () => {
    const routes = endpoints.filter(e => !(key(e) in APPROVED_PUBLIC));
    expect(routes.length).toBeGreaterThan(MIN_ROUTES);
    const wrong = await sweep(anonymous(server.base), routes, 401);
    expect(wrong, 'These answered someone who isn\'t signed in without a 401').toEqual([]);
  }, 120_000);

  it('refuses every role-restricted route — including a colleague\'s pay, appraisals and records — to a teacher with no modules', async () => {
    const teacher = await signIn(server.base, PERSONAS.teacher.email, PERSONA_PASSWORD);
    const routes = endpoints.filter(e => !(key(e) in APPROVED_PUBLIC) && !(key(e) in APPROVED_ANY_SIGNED_IN));
    expect(routes.length).toBeGreaterThan(MIN_ROUTES);
    const wrong = await sweep(teacher, routes, 403);
    expect(wrong, 'These let a teacher with no access through (or failed in another way)').toEqual([]);
  }, 120_000);

  it('refuses the live new-lead stream to anyone outside Marketing', async () => {
    expect((await anonymous(server.base).call('GET', '/api/events')).status).toBe(401);
    const teacher = await signIn(server.base, PERSONAS.teacher.email, PERSONA_PASSWORD);
    expect((await teacher.call('GET', '/api/events')).status).toBe(403);
  });
});
