import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import {
  authRoleModules, authRoles, authRoleViews, bugReports, careerMissions, featureRequests, positions, purchaseRequestLogs, purchaseRequests,
  sensitiveAccessLogs, sopFavorites, sopSteps, sopTemplateRevisions, sopTemplates, teacherMissionProgress, teachers, users,
} from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';

// A teacher set up exactly the way real teachers are: their position carries
// the "Teacher" access role — the Operation module and NO approval views. Over
// real HTTP, through the real login: everything a teacher does day to day
// works, and nothing that approves, decides or manages for others does.

const NOW = new Date('2026-01-01T00:00:00Z');
const PASSWORD = 'Default-Teacher-42';
const ME = { userId: 'u-dee', teacherId: 't-dee', email: 'dee@kindertech.test' };
const GUIDE = 'g-dropoff';
const MISSION = 'm-routines';

let server: LiveServer;
let dee: Caller;

beforeAll(async () => {
  await resetTables(sensitiveAccessLogs, purchaseRequestLogs, purchaseRequests, bugReports, featureRequests, sopFavorites, sopTemplateRevisions, sopSteps,
    sopTemplates, teacherMissionProgress, careerMissions, users, teachers, positions, authRoleViews, authRoleModules, authRoles);
  await db.insert(authRoles).values({ id: 'role-teacher', name: 'Teacher', createdAt: NOW, updatedAt: NOW });
  await db.insert(authRoleModules).values({ id: 'arm-teacher-op', authRoleId: 'role-teacher', module: 'OPERATION', createdAt: NOW });
  await db.insert(positions).values({ positionId: 'EI', name: 'Junior EI', authRoleId: 'role-teacher', createdAt: NOW, updatedAt: NOW });
  await db.insert(teachers).values({ id: ME.teacherId, name: 'Dee Default', color: '#7c3aed', positionId: 'EI', createdAt: NOW, updatedAt: NOW });
  await db.insert(users).values({
    id: ME.userId, email: ME.email, name: 'Dee Default', passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: 'USER', activated: true, teacherId: ME.teacherId, createdAt: NOW, updatedAt: NOW,
  });
  await db.insert(sopTemplates).values({ id: GUIDE, title: 'Morning drop-off', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopSteps).values({ id: 's1', sopTemplateId: GUIDE, section: 'Arrival', title: 'Greet the parent', createdAt: NOW, updatedAt: NOW });
  await db.insert(careerMissions).values({ id: MISSION, positionId: 'EI', title: 'Master routines', category: 'CLASSROOM', createdAt: NOW, updatedAt: NOW });
  server = await startLiveServer();
  dee = await signIn(server.base, ME.email, PASSWORD);
});
afterAll(async () => {
  await server?.close();
  await pool.end();
});

const ok = (status: number) => status >= 200 && status < 300;

describe('Security — a default teacher can do their everyday work', () => {
  it('has the Operation module and no approval views, exactly as real teachers are set up', async () => {
    const r = await dee.call('GET', '/api/me/permissions');
    expect(r.body).toMatchObject({ isAdmin: false, modules: ['OPERATION'], views: [] });
  });

  it('reads guides, suggests a new one, stars one, and follows their own suggestions', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/sop-templates'],
      ['GET', `/api/sop-steps?sopTemplateId=${GUIDE}`],
      ['POST', '/api/sop-revisions', { title: 'Fire drill', goal: 'Everyone out safely', steps: [{ section: 'Main', title: 'Line up' }] }],
      ['GET', '/api/sop-revisions'],
      ['PUT', `/api/sop-favorites/${GUIDE}`],
      ['GET', '/api/sop-favorites'],
    ] as [string, string, unknown?][]) {
      const r = await dee.call(method, path, body);
      expect(ok(r.status), `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
  });

  it('requests an item, reports a bug, sends a feature idea, and sees their own incidents, facility reports and requests', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/purchase-requests', { item: 'Glue sticks', quantity: '10', purpose: 'Class 2' }],
      ['GET', '/api/purchase-requests/mine'],
      ['POST', '/api/bug-reports', { title: 'Save does nothing', message: 'Tapped save on Steps and nothing happened.' }],
      ['POST', '/api/feature-requests', { title: 'Dark mode', message: 'A darker look for evening planning.' }],
      ['GET', '/api/incidents/mine'],
      ['GET', '/api/facility-issues/mine'],
    ] as [string, string, unknown?][]) {
      const r = await dee.call(method, path, body);
      expect(ok(r.status), `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
  });

  it('works on their own quests — pins one and submits it for review — and sees their own points and appraisals', async () => {
    for (const [method, path, body] of [
      ['PUT', `/api/teachers/${ME.teacherId}/missions/${MISSION}/target`, { isTargeted: true }],
      ['PUT', `/api/teachers/${ME.teacherId}/missions/${MISSION}/progress`, { status: 'UNDER_REVIEW' }],
      ['GET', `/api/teachers/${ME.teacherId}/points`],
      ['GET', `/api/teachers/${ME.teacherId}/appraisals`],
    ] as [string, string, unknown?][]) {
      const r = await dee.call(method, path, body);
      expect(ok(r.status), `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
  });
});

describe('Security — a default teacher cannot approve, decide or manage', () => {
  /** Every approval / decision / management action — each must be refused. */
  const MANAGER_ACTIONS: [string, string, unknown?][] = [
    // How-To Guides — reviewing suggestions and editing the live guides.
    ['POST', '/api/sop-revisions/any/approve'],
    // How-To Guides — making (or replacing) a guide's AI poster.
    ['POST', '/api/sop-templates/any/poster/draft'],
    ['POST', '/api/sop-templates/any/poster/accept'],
    // Practice observations — certifying a trainee, or sending them back for more training.
    ['POST', '/api/sop-observations/any/advance', {}],
    ['POST', '/api/sop-observations/any/send-back', { stepResults: [] }],
    ['POST', '/api/sop-revisions/any/reject', { reviewNote: 'no' }],
    ['POST', '/api/sop-revisions/any/trial'],
    ['POST', '/api/sop-revisions/any/return', { reviewNote: 'change it' }],
    ['PATCH', '/api/sop-revisions/any', { title: 'x', steps: [] }],
    ['POST', '/api/sop-templates', { title: 'x' }],
    ['PATCH', `/api/sop-templates/${GUIDE}`, { title: 'Renamed' }],
    ['DELETE', `/api/sop-templates/${GUIDE}`],
    ['POST', '/api/sop-steps', { sopTemplateId: GUIDE, section: 'x', title: 'x' }],
    // Shopping list.
    ['GET', '/api/purchase-requests/shopping-list'],
    ['POST', '/api/purchase-requests/approve-all'],
    ['POST', '/api/purchase-requests/any/approve'],
    ['POST', '/api/purchase-requests/any/not-buying', { reason: 'no' }],
    // Incidents and facilities — the office's queues.
    ['GET', '/api/incidents'],
    ['PATCH', '/api/incidents/any', { status: 'CLOSED' }],
    ['GET', '/api/facility-issues'],
    ['PATCH', '/api/facility-issues/any/status', { status: 'DONE' }],
    // Points, rewards, appraisals, quests — HR's decisions about people (including themselves).
    ['POST', `/api/teachers/${ME.teacherId}/points/grant`, { amount: 100, reason: 'self' }],
    ['PATCH', '/api/redemptions/any', { status: 'delivered' }],
    ['POST', `/api/teachers/${ME.teacherId}/appraisals`, { score: 100 }],
    // Rewriting a new joiner's own onboarding steps — even their own.
    ['PUT', `/api/teachers/${ME.teacherId}/onboarding/own-steps`, { progress: [{ task: 'x', done: true }] }],
    // Appraising with a form: running the schedule, and signing off someone else's.
    ['GET', '/api/appraisal-schedules'],
    ['GET', '/api/appraisal-schedules/created'],
    ['GET', '/api/performance/staff'],
    ['POST', '/api/appraisals/start', { teacherId: ME.teacherId, familyId: 'any', year: 2026, month: 0 }],
    ['POST', '/api/appraisal-schedules', { familyId: 'any', teacherIds: [ME.teacherId], repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-01-01' }],
    ['DELETE', '/api/appraisal-schedules/any'],
    ['POST', '/api/appraisal-schedules/any/create-now'],
    ['POST', '/api/appraisal-runs/any/approve'],
    ['POST', '/api/appraisal-runs/any/send-back', { reason: 'redo' }],
    ['DELETE', '/api/appraisal-runs/any'],
    ['POST', '/api/staff-joins/any/approve'],
    ['POST', '/api/career-missions', { title: 'x' }],
    // Bug reports are fixed by the Tools team.
    ['POST', '/api/bug-reports/any/resolve'],
    // Publishing (or taking back) a month's profit sharing — the Finance Manager's.
    ['POST', '/api/profit-sharing/publications/2025/0/publish'],
    ['POST', '/api/profit-sharing/publications/2025/0/unpublish', { reason: 'x' }],
    // Hiding school news — whoever runs enrolment (Students).
    ['POST', '/api/school-news/any/hide'],
    // Feature requests are read and reviewed by admins.
    ['GET', '/api/feature-requests'],
    ['POST', '/api/feature-requests/any/review'],
  ];

  it('is refused every approval and manager action', async () => {
    const allowed: string[] = [];
    for (const [method, path, body] of MANAGER_ACTIONS) {
      const r = await dee.call(method, path, body);
      if (r.status !== 403) allowed.push(`${method} ${path} → ${r.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it('cannot mark their own quest complete — HR or a supervisor approves it', async () => {
    const r = await dee.call('PUT', `/api/teachers/${ME.teacherId}/missions/${MISSION}/progress`, { status: 'COMPLETED' });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/submit it for review/);
  });
});
