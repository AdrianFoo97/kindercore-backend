import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  authRoleModules, authRoles, authRoleViews, positions, sensitiveAccessLogs, systemSettings, teachers, users,
} from '../../db/schema.js';
import { HR_ONLY_TEACHER_FIELDS } from '../../controllers/planner.controller.js';
import { resetAccessDedupe } from '../../services/accessLog.service.js';
import { resetTables } from './testDb.js';
import { anonymous, signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { OWNER_TEACHER_ID, PERSONA_PASSWORD, PERSONAS, personaRows, type Persona } from '../fixtures/personas.js';

// Who may open each kind of sensitive record — every person, over real HTTP,
// signed in through the real login. The sweep proves the wrong people are
// refused; this proves the RIGHT people get in (so "secure" isn't just
// "broken for everyone"), and that what each person receives holds nothing
// they shouldn't see.

type Who = Persona | 'nobody';
const EVERYONE: Who[] = ['nobody', 'teacher', 'owner', 'hr', 'finance', 'analysis', 'admin'];
const OWNER = OWNER_TEACHER_ID;

/** Each sensitive read, and exactly who may open it. Everyone else must be refused. */
const MATRIX: { what: string; path: string; allowed: Who[] }[] = [
  { what: 'School finances', path: '/api/finance/summary', allowed: ['finance', 'analysis', 'admin'] },
  { what: 'Each month’s profit-share pool and who published it', path: '/api/profit-sharing/publications?year=2026', allowed: ['analysis', 'admin'] },
  { what: 'P&L lines an import left out (can include salaries)', path: '/api/operating-cost/import/notices?year=2026&month=8', allowed: ['finance', 'admin'] },
  { what: 'Every past P&L import (can include salaries)', path: '/api/operating-cost/import/history', allowed: ['finance', 'admin'] },
  { what: 'Everyone\'s salaries', path: '/api/salary/teachers', allowed: ['hr', 'finance', 'analysis', 'admin'] },
  { what: 'Payroll by month', path: '/api/salary/payroll-by-month', allowed: ['hr', 'finance', 'analysis', 'admin'] },
  { what: 'Profit-share weights of every staff member', path: '/api/salary/teacher-weights-by-month', allowed: ['hr', 'finance', 'analysis', 'admin'] },
  { what: 'Employer contributions', path: '/api/salary/employer-contributions', allowed: ['hr', 'finance', 'analysis', 'admin'] },
  { what: 'One person\'s allowances', path: `/api/teachers/${OWNER}/allowances`, allowed: ['owner', 'hr', 'admin'] },
  { what: 'One person\'s pay pools', path: `/api/teachers/${OWNER}/pay-pools`, allowed: ['owner', 'hr', 'admin'] },
  { what: 'One person\'s own pay record', path: `/api/salary/teachers/${OWNER}`, allowed: ['owner', 'hr', 'admin'] },
  { what: 'One person\'s appraisals', path: `/api/teachers/${OWNER}/appraisals`, allowed: ['owner', 'hr', 'admin'] },
  { what: 'Appraisals of all staff', path: '/api/appraisals/overview', allowed: ['hr', 'admin'] },
  { what: 'Who is scheduled for appraisal, on which form', path: '/api/appraisal-schedules', allowed: ['hr', 'admin'] },
  { what: 'Every appraisal the schedule has created', path: '/api/appraisal-schedules/created', allowed: ['hr', 'admin'] },
  { what: 'Job applicants', path: '/api/candidates', allowed: ['hr', 'admin'] },
  { what: 'User accounts', path: '/api/auth/users', allowed: ['admin'] },
  { what: 'The access log', path: '/api/admin/access-log', allowed: ['admin'] },
];

let server: LiveServer;
const callers = {} as Record<Who, Caller>;

beforeAll(async () => {
  resetAccessDedupe();
  await resetTables(sensitiveAccessLogs, users, teachers, positions, authRoleViews, authRoleModules, authRoles);
  await db.delete(systemSettings).where(eq(systemSettings.key, 'secret.matrix_probe'));
  const rows = await personaRows();
  await db.insert(authRoles).values(rows.authRoles);
  await db.insert(authRoleModules).values(rows.authRoleModules);
  await db.insert(authRoleViews).values(rows.authRoleViews);
  await db.insert(positions).values(rows.positions);
  await db.insert(teachers).values(rows.teachers);
  await db.insert(users).values(rows.users);
  await db.insert(systemSettings).values({ id: 'set-secret-probe', key: 'secret.matrix_probe', value: JSON.stringify('do-not-leak'), updatedAt: new Date() });
  server = await startLiveServer();
  callers.nobody = anonymous(server.base);
  for (const p of Object.keys(PERSONAS) as Persona[]) callers[p] = await signIn(server.base, PERSONAS[p].email, PERSONA_PASSWORD);
}, 60_000);
afterAll(async () => {
  await db.delete(systemSettings).where(eq(systemSettings.key, 'secret.matrix_probe'));
  await server?.close();
  await pool.end();
});

describe('Security — who may open each kind of sensitive record (live HTTP)', () => {
  it('gives each sensitive record to exactly the people allowed, and refuses everyone else', async () => {
    const wrong: string[] = [];
    for (const row of MATRIX) {
      for (const who of EVERYONE) {
        const { status } = await callers[who].call('GET', row.path);
        const allowed = row.allowed.includes(who);
        const expected = allowed ? 200 : who === 'nobody' ? 401 : 403;
        if (status !== expected) wrong.push(`${row.what} — ${who}: got ${status}, expected ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it('shows a teacher their colleagues by name only — never pay, phone or date of birth', async () => {
    const asTeacher = (await callers.teacher.call('GET', '/api/planner/teachers')).body as Record<string, unknown>[];
    const olive = asTeacher.find(t => t.id === OWNER)!;
    expect(Object.keys(olive).sort()).toEqual(['color', 'id', 'isActive', 'name']);
    // HR-only-to-CHANGE fields; "isActive" (still working here) is shown to colleagues on purpose, for scheduling.
    for (const f of HR_ONLY_TEACHER_FIELDS.filter(f => f !== 'isActive')) expect(olive, f).not.toHaveProperty(f);
    // HR does see them — so the redaction is deliberate, not missing data.
    const asHr = (await callers.hr.call('GET', '/api/planner/teachers')).body as Record<string, unknown>[];
    expect(asHr.find(t => t.id === OWNER)).toMatchObject({ phone: '012-3456789', fixedSalaryAmount: 4321 });
  });

  it('never sends secret settings to anyone, not even an Admin', async () => {
    for (const who of ['teacher', 'admin'] as const) {
      const settings = (await callers[who].call('GET', '/api/settings')).body as Record<string, unknown>;
      expect(Object.keys(settings).filter(k => k.startsWith('secret.')), who).toEqual([]);
      expect(JSON.stringify(settings), who).not.toContain('do-not-leak');
    }
  });

  it('gives a teacher only their own pool figures — no school finances', async () => {
    const pools = (await callers.owner.call('GET', `/api/teachers/${OWNER}/pay-pools`)).body;
    expect(Object.keys(pools).sort()).toEqual(['annualBonus', 'quarterIdx', 'teamPool', 'year']);
    for (const secret of ['revenue', 'staffCost', 'operatingCost', 'profit', 'weight', 't-tina']) {
      expect(JSON.stringify(pools), secret).not.toContain(secret);
    }
  });

  it('refuses a change made with someone\'s session unless it comes from the app itself', async () => {
    const forged = await callers.teacher.call('POST', '/api/bug-reports', { title: 'x' }, { appHeader: false });
    expect(forged.status).toBe(403);
    const fromApp = await callers.teacher.call('POST', '/api/bug-reports', {});
    expect(fromApp.status).not.toBe(403);
  });

  it('cuts off an account the moment it is deactivated, even mid-session', async () => {
    const hr = await signIn(server.base, PERSONAS.hr.email, PERSONA_PASSWORD);
    expect((await hr.call('GET', '/api/salary/teachers')).status).toBe(200);
    await db.update(users).set({ activated: false }).where(eq(users.id, PERSONAS.hr.id));
    try {
      expect((await hr.call('GET', '/api/salary/teachers')).status).toBe(401);
    } finally {
      await db.update(users).set({ activated: true }).where(eq(users.id, PERSONAS.hr.id));
    }
  });

  it('writes each view of someone else\'s record to the access log, but not a person viewing their own', async () => {
    resetAccessDedupe();
    await resetTables(sensitiveAccessLogs);
    await callers.hr.call('GET', `/api/teachers/${OWNER}/allowances`);
    await callers.owner.call('GET', `/api/teachers/${OWNER}/allowances`);
    await new Promise(r => setTimeout(r, 200));
    const entries = await db.select().from(sensitiveAccessLogs);
    expect(entries.map(e => [e.userId, e.area, e.subjectTeacherId])).toEqual([[PERSONAS.hr.id, 'STAFF_PAY', OWNER]]);
  });
});
