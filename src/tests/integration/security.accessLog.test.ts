import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { db, pool } from '../../db/client.js';
import { sensitiveAccessLogs, teachers, users } from '../../db/schema.js';
import { logSensitiveAccess } from '../../middlewares/accessLog.middleware.js';
import { purgeOldAccessLog, recordAccess, resetAccessDedupe } from '../../services/accessLog.service.js';
import { getAccessLog } from '../../controllers/access-log.controller.js';
import { resetTables } from './testDb.js';
import { res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Admin → Access Log: who opened pay, finance, appraisal and applicant
// records. Real middleware and handler, test DB.

const NOW = new Date('2026-11-11T02:00:00Z');
const HR = { id: 'user-hr', email: 'hr@kindertech.test', role: 'USER', teacherId: 't-hr' };
const TINA = { id: 'user-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-tina' };

/** Run the recorder for one request, finishing with the given status; waits for the write. */
async function view(area: 'PAYROLL' | 'STAFF_PAY', user: typeof HR, status = 200, params: Record<string, string> = {}, path = '/teachers') {
  const response = Object.assign(new EventEmitter(), { statusCode: status });
  const request = { user, params, method: 'GET', baseUrl: '/api/salary', route: { path }, ip: '10.0.0.5' };
  logSensitiveAccess(area)(request as never, response as never, () => undefined);
  response.emit('finish');
  await new Promise(r => setTimeout(r, 50));
}
const rows = () => db.select().from(sensitiveAccessLogs);

beforeEach(async () => {
  resetAccessDedupe();
  await resetTables(sensitiveAccessLogs, teachers, users);
  await db.insert(users).values([
    await activeUser({ id: HR.id, email: HR.email, name: 'Hana HR', role: 'USER', teacherId: HR.teacherId }),
    await activeUser({ id: TINA.id, email: TINA.email, name: 'Tina Teacher', role: 'USER', teacherId: TINA.teacherId }),
  ]);
  await db.insert(teachers).values([
    { id: 't-hr', name: 'Hana HR', color: '#7c3aed', createdAt: NOW, updatedAt: NOW },
    { id: 't-tina', name: 'Tina Teacher', color: '#7c3aed', createdAt: NOW, updatedAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

describe('Access log — recording', () => {
  it('records who opened a sensitive record, what it was and whose — once per few minutes, not on every refresh', async () => {
    await view('STAFF_PAY', HR, 200, { teacherId: 't-tina' }, '/teachers/:teacherId/allowances');
    await view('STAFF_PAY', HR, 200, { teacherId: 't-tina' }, '/teachers/:teacherId/allowances');
    const [entry, ...more] = await rows();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      userId: HR.id, userEmail: HR.email, area: 'STAFF_PAY', action: 'GET /api/salary/teachers/:teacherId/allowances', subjectTeacherId: 't-tina', ip: '10.0.0.5',
    });
  });

  it('never records someone opening their own record, or a request that was refused', async () => {
    await view('STAFF_PAY', TINA, 200, { teacherId: 't-tina' });
    await view('PAYROLL', TINA, 403);
    expect(await rows()).toHaveLength(0);
  });
});

describe('Access log — the admin page', () => {
  const list = async (query: Record<string, string> = {}) => {
    const r = res();
    await getAccessLog({ query } as never, r);
    return r;
  };

  it('lists newest first with names, and filters by area and by person', async () => {
    await recordAccess({ userId: HR.id, userEmail: HR.email, area: 'PAYROLL', action: 'GET /api/salary/teachers', subjectTeacherId: null, ip: null }, new Date(Date.now() - 60_000));
    await recordAccess({ userId: HR.id, userEmail: HR.email, area: 'STAFF_PAY', action: 'GET /api/teachers/:teacherId/allowances', subjectTeacherId: 't-tina', ip: null });
    const all = await list();
    expect(all.statusCode).toBe(200);
    expect(all.body.rows.map((r: any) => [r.areaLabel, r.userName, r.subjectName])).toEqual([
      ['A staff member’s pay', 'Hana HR', 'Tina Teacher'],
      ['Payroll', 'Hana HR', null],
    ]);
    expect((await list({ area: 'PAYROLL' })).body.rows).toHaveLength(1);
    expect((await list({ q: 'tina' })).body.total).toBe(1);
    expect((await list({ area: 'NOT_AN_AREA' })).statusCode).toBe(400);
  });

  it('keeps entries for a year, then removes them', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    await recordAccess({ userId: HR.id, userEmail: HR.email, area: 'PAYROLL', action: 'GET /a', subjectTeacherId: null, ip: null }, new Date(NOW.getTime() - 400 * DAY));
    await recordAccess({ userId: HR.id, userEmail: HR.email, area: 'PAYROLL', action: 'GET /b', subjectTeacherId: null, ip: null }, new Date(NOW.getTime() - 30 * DAY));
    expect(await purgeOldAccessLog(NOW)).toBe(1);
    expect((await rows()).map(r => r.action)).toEqual(['GET /b']);
  });
});
