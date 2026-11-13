import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { bugReports, users } from '../../db/schema.js';
import { createBugReport } from '../../controllers/bug-reports.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Report a Bug: a short title and a description, so whoever fixes it can scan
// the list by title and read the details. Real handler, test DB.

const NOW = new Date('2026-01-01T00:00:00Z');
const ME = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: null };

beforeEach(async () => {
  await resetTables(bugReports, users);
  await db.insert(users).values({ id: ME.id, email: ME.email, name: 'Tina Teacher', passwordHash: 'x', role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW });
});
afterAll(async () => {
  await pool.end();
});

const report = async (body: Record<string, unknown>) => { const r = res(); await createBugReport(reqWith({ user: ME, body }), r); return r; };

describe('Admin — bug reports', () => {
  it('saves a title and a description, tidied, with who sent it', async () => {
    const r = await report({ title: '  Leave request won’t save ', message: ' Tapped Save on Pay → Leave and nothing happened. ' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ title: 'Leave request won’t save', message: 'Tapped Save on Pay → Leave and nothing happened.', reportedByName: 'Tina Teacher', status: 'OPEN' });
  });

  it('needs both a title and a description', async () => {
    expect((await report({ message: 'Something broke' })).statusCode).toBe(400);
    expect((await report({ title: '   ', message: 'Something broke' })).statusCode).toBe(400);
    expect((await report({ title: 'Broke', message: '  ' })).statusCode).toBe(400);
    expect(await db.select().from(bugReports)).toHaveLength(0);
  });
});
