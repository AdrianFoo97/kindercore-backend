import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { classrooms, subjects, systemSettings, users } from '../../db/schema.js';
import { ensureBranchIds } from '../../services/branches.service.js';
import { BRANCHES_SETTING } from '../../services/branches.logic.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Classes and subjects per branch, over real HTTP: existing ones move under the
// first branch, a whole branch can be copied to another (adding only what's
// missing), and a branch that still has classes can't be removed.

const NOW = new Date('2026-01-01T00:00:00Z');
const A = 'branch-a';
const B = 'branch-b';

let server: LiveServer;
let admin: Caller;

beforeAll(async () => {
  await resetTables(users);
  await db.insert(users).values(await activeUser({ id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' }));
  server = await startLiveServer();
  admin = await signIn(server.base, 'admin@kindertech.test', PASSWORD);
}, 120_000);
beforeEach(async () => {
  await resetTables(classrooms, subjects);
  await db.delete(systemSettings).where(eq(systemSettings.key, BRANCHES_SETTING));
  await db.insert(systemSettings).values({ id: 'set-branches', key: BRANCHES_SETTING, value: [{ id: A, name: 'Bukit Indah', address: 'x' }, { id: B, name: 'Skudai', address: 'y' }] as never, updatedAt: NOW });
});
afterAll(async () => {
  await db.delete(systemSettings).where(eq(systemSettings.key, BRANCHES_SETTING));
  await server?.close();
  await pool.end();
});

const classesAt = async (branchId: string) => (await db.select().from(classrooms).where(eq(classrooms.branchId, branchId))).map(c => c.name).sort();

describe('Planner — branches', () => {
  it('puts existing classes and subjects without a branch under the first branch', async () => {
    await db.insert(classrooms).values({ id: 'c-old', name: 'N1', createdAt: NOW, updatedAt: NOW });
    await db.insert(subjects).values({ id: 's-old', name: 'Math', color: '#22c55e', createdAt: NOW });
    await ensureBranchIds();
    expect(await classesAt(A)).toEqual(['N1']);
    expect((await db.select().from(subjects))[0].branchId).toBe(A);
  });

  it('copies a whole branch — classes, then subjects pointing at the new classes — and a second copy adds nothing', async () => {
    const n1 = (await admin.call('POST', '/api/planner/classrooms', { name: 'N1', branchId: A, capacity: 20 })).body.id;
    await admin.call('POST', '/api/planner/classrooms', { name: 'N2', branchId: A });
    await admin.call('POST', '/api/planner/subjects', { name: 'Math', color: '#ef4444', branchId: A, classLessons: { [n1]: 3 } });

    const r = await admin.call('POST', '/api/planner/branches/copy', { fromBranchId: A, toBranchId: B });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ addedClasses: 2, addedSubjects: 1, skippedClasses: 0, skippedSubjects: 0 });
    expect(await classesAt(B)).toEqual(['N1', 'N2']);
    const [bN1] = await db.select().from(classrooms).where(eq(classrooms.branchId, B)).then(rows => rows.filter(c => c.name === 'N1'));
    const [bMath] = await db.select().from(subjects).where(eq(subjects.branchId, B));
    expect(bMath.classLessons).toEqual({ [bN1.id]: 3 });
    expect(bN1.capacity).toBe(20);

    const again = await admin.call('POST', '/api/planner/branches/copy', { fromBranchId: A, toBranchId: B });
    expect(again.body).toEqual({ addedClasses: 0, addedSubjects: 0, skippedClasses: 2, skippedSubjects: 1 });
    expect((await admin.call('POST', '/api/planner/branches/copy', { fromBranchId: A, toBranchId: A })).status).toBe(400);
    expect((await admin.call('POST', '/api/planner/branches/copy', { fromBranchId: A, toBranchId: 'nope' })).status).toBe(404);
  });

  it('copies only the ticked classes', async () => {
    const n1 = (await admin.call('POST', '/api/planner/classrooms', { name: 'N1', branchId: A })).body.id;
    await admin.call('POST', '/api/planner/classrooms', { name: 'N2', branchId: A });
    await admin.call('POST', '/api/planner/subjects', { name: 'Math', color: '#ef4444', branchId: A });
    const r = await admin.call('POST', '/api/planner/branches/copy', { fromBranchId: A, toBranchId: B, classIds: [n1], subjectIds: [] });
    expect(r.body).toEqual({ addedClasses: 1, addedSubjects: 0, skippedClasses: 0, skippedSubjects: 0 });
    expect(await classesAt(B)).toEqual(['N1']);
  });

  it('won’t remove a branch that still has classes, but keeps ids when branches are renamed', async () => {
    await admin.call('POST', '/api/planner/classrooms', { name: 'N1', branchId: B });
    const remove = await admin.call('PATCH', `/api/settings/${BRANCHES_SETTING}`, { value: [{ id: A, name: 'Bukit Indah', address: 'x' }] });
    expect(remove.status).toBe(409);
    const rename = await admin.call('PATCH', `/api/settings/${BRANCHES_SETTING}`, { value: [{ id: A, name: 'Bukit Indah', address: 'x' }, { id: B, name: 'Skudai Centre', address: 'y' }, { name: 'Mount Austin', address: 'z' }] });
    expect(rename.status).toBe(200);
    const saved = rename.body.value as { id: string; name: string }[];
    expect(saved.slice(0, 2).map(b => b.id)).toEqual([A, B]);
    expect(saved[2].id).toBeTruthy(); // a new branch gets its own id
  });
});
