import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { notificationMutes, notifications, userAuthRoles, users } from '../../db/schema.js';
import { BUILT_IN_ROLES } from '../../constants/accessRoles.js';
import { notify } from '../../services/notifications.service.js';
import {
  type NotificationKind, NOTIFICATION_EVENTS, NOTIFICATION_KINDS, appraisalSignOffMessage, bugReportedMessage, costsRecordedMessage, facilityMessage, featureRequestedMessage,
  guideSuggestedMessage, incidentMessage, itemBoughtMessage, itemRequestedMessage, newApplicationMessage, newLeadMessage,
  newStaffJoinMessage, newStudentMessage, onboardingSelfDoneMessage, studentWithdrawnMessage,
} from '../../services/notifications.logic.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Every access role, signed in for real: which notifications it gets, what its
// notification settings offer, and that it can open the page behind every
// notification it gets. The expected list per role is written out below so a
// change to roles or notifications that breaks it shows up here.

const HR = ['NEW_APPLICATION', 'NEW_STAFF_JOIN', 'ONBOARDING_SELF_DONE', 'APPRAISAL_SIGN_OFF'];
const ALL: NotificationKind[] = NOTIFICATION_KINDS;
/** “About you” — every staff member gets these, whatever their roles (shown last in settings). */
const PERSONAL = NOTIFICATION_EVENTS.filter(e => e.audience.personal).map(e => e.kind);
const ROLE_BASED = ALL.filter(k => !PERSONAL.includes(k));

/**
 * Exactly what each built-in role is offered in settings (in Settings order).
 * “Appraisal ready for sign-off” is offered to anyone who can be on a sign-off
 * step (HR, or Operation with a managing function — not a plain Teacher) but only SENT to the people who can sign off that
 * appraisal — see hr.appraisalRuns.test.ts.
 */
const EXPECTED: Record<string, string[]> = {
  'builtin:MARKETING_EXECUTIVE': ['NEW_LEAD'],
  'builtin:FRONT_DESK_OFFICER': ['NEW_STUDENT', 'STUDENT_WITHDRAWN'],
  'builtin:HR_MANAGER': HR,
  'builtin:HR_DIRECTOR': HR,
  // A Team Lead only manages their team: no recruitment / new-staff news, just sign-offs.
  'builtin:TEAM_LEAD': ['APPRAISAL_SIGN_OFF'],
  'builtin:ACCOUNTS_EXECUTIVE': ['ITEM_BOUGHT'],
  'builtin:FINANCE_MANAGER': ['ITEM_BOUGHT', 'COSTS_RECORDED'],
  // A plain teacher: only the “About you” ones (added below for every staff account).
  'builtin:TEACHER': [],
  'builtin:SUPERVISOR': ['APPRAISAL_SIGN_OFF', 'INCIDENT_REPORTED', 'ITEM_REQUESTED', 'GUIDE_SUGGESTED'],
  'builtin:OPERATIONS_MANAGER': ['APPRAISAL_SIGN_OFF', 'INCIDENT_REPORTED', 'FACILITY_REPORTED', 'ITEM_REQUESTED', 'GUIDE_SUGGESTED'],
  'builtin:PRINCIPAL': ROLE_BASED,
  'builtin:ANALYST': ['COSTS_RECORDED'],
  admin: ROLE_BASED,
  'no role': [],
};
/** Everyone here is on the staff except the admin and the no-role account, so they also get the personal ones. */
const isStaff = (who: string) => who.startsWith('builtin:');
const expectedFor = (who: string) => [...EXPECTED[who], ...(isStaff(who) ? PERSONAL : [])];

/** The request behind each notification's page — being let through (not 401/403) means you can open it. */
const DESTINATION: Record<string, [string, string]> = {
  NEW_LEAD: ['GET', '/api/leads/no-such-lead'],
  NEW_STUDENT: ['GET', '/api/students/no-such-student/enrollments'],
  STUDENT_WITHDRAWN: ['GET', '/api/students/no-such-student/enrollments'],
  NEW_APPLICATION: ['GET', '/api/candidates/no-such-candidate'],
  NEW_STAFF_JOIN: ['GET', '/api/staff-joins'],
  ONBOARDING_SELF_DONE: ['GET', '/api/staff-onboarding'],
  APPRAISAL_SIGN_OFF: ['GET', '/api/appraisal-runs/no-such-run'],
  INCIDENT_REPORTED: ['GET', '/api/incidents'],
  FACILITY_REPORTED: ['GET', '/api/facility-issues'],
  ITEM_REQUESTED: ['GET', '/api/purchase-requests/shopping-list'],
  GUIDE_SUGGESTED: ['POST', '/api/sop-revisions/no-such-suggestion/approve'],
  ITEM_BOUGHT: ['PUT', '/api/operating-cost/entries'],
  COSTS_RECORDED: ['GET', '/api/operating-cost/entries?year=2026'],
  BUG_REPORTED: ['GET', '/api/bug-reports'],
  FEATURE_REQUESTED: ['GET', '/api/feature-requests'],
};

const MESSAGES = [
  newLeadMessage({ id: 'l1', childName: 'Aisha' }),
  newStudentMessage({ id: 's1', childName: 'Aisha' }),
  studentWithdrawnMessage({ id: 's1', childName: 'Aisha' }),
  itemBoughtMessage({ item: 'Glue', quantity: 2, cost: '12.50' }),
  costsRecordedMessage({ year: 2026, month: 10 }),
  newApplicationMessage({ id: 'c1', fullName: 'Siti' }),
  newStaffJoinMessage({ fullName: 'Lim' }),
  onboardingSelfDoneMessage({ name: 'Lim' }),
  appraisalSignOffMessage({ id: 'a1', teacherName: 'Tina', formName: 'Monthly', scoredByName: 'Sam' }),
  incidentMessage({ id: 'i1', location: 'Playground', reportedByName: 'Tina' }),
  facilityMessage({ title: 'Door', location: 'Toilet', reportedByName: 'Tina' }),
  itemRequestedMessage({ item: 'Glue', quantity: 2, requestedByName: 'Tina' }),
  guideSuggestedMessage({ id: 'g1', title: 'Pick-up', byName: 'Tina', isNewGuide: true }),
  bugReportedMessage({ title: 'Save does nothing', reportedByName: 'Tina' }),
  featureRequestedMessage({ title: 'Dark mode', requestedByName: 'Tina' }),
];

/** Sent to whole roles (everything but targeted events — sign-off and the personal ones). */
const TARGETED = NOTIFICATION_EVENTS.filter(e => e.audience.targeted).map(e => e.kind as string);
const broadcast = (kinds: string[]) => kinds.filter(k => !TARGETED.includes(k));

const NOW = new Date('2026-01-01T00:00:00Z');
const userIdOf = (who: string) => `u-${who.replace(/[^a-z]/gi, '-').toLowerCase()}`;
let server: LiveServer;
const callers: Record<string, Caller> = {};

beforeAll(async () => {
  await resetTables(notifications, notificationMutes, userAuthRoles, users);
  for (const who of Object.keys(EXPECTED)) {
    const id = userIdOf(who);
    await db.insert(users).values(await activeUser({
      id, email: `${id}@kindertech.test`, name: who, role: who === 'admin' ? 'ADMIN' : 'USER', teacherId: isStaff(who) ? `t-${id}` : null,
    }));
    if (who.startsWith('builtin:')) await db.insert(userAuthRoles).values({ id: `uar-${id}`, userId: id, authRoleId: who, createdAt: NOW });
  }
  server = await startLiveServer();
  for (const who of Object.keys(EXPECTED)) callers[who] = await signIn(server.base, `${userIdOf(who)}@kindertech.test`, PASSWORD);
}, 120_000);
beforeEach(async () => { await resetTables(notifications, notificationMutes); });
afterAll(async () => { await server?.close(); await pool.end(); });

describe('Notifications — every access role', () => {
  it('covers every built-in role', () => {
    for (const r of BUILT_IN_ROLES) expect(Object.keys(EXPECTED), r.id).toContain(r.id);
  });

  it('offers each role exactly its notifications in settings, saying which role gives them', async () => {
    for (const who of Object.keys(EXPECTED)) {
      const r = await callers[who].call('GET', '/api/notifications/settings');
      expect(r.status, who).toBe(200);
      const events = r.body.events as { kind: string; from: string[] }[];
      expect(events.map(e => e.kind), who).toEqual(expectedFor(who));
      const source = who === 'admin' ? 'Admin account' : BUILT_IN_ROLES.find(b => b.id === who)?.name;
      for (const e of events) expect(e.from, `${who} ${e.kind}`).toEqual([PERSONAL.includes(e.kind as NotificationKind) ? (NOTIFICATION_EVENTS.find(x => x.kind === e.kind)?.source ?? 'Your own work') : source]);
    }
  });

  it('delivers each event to exactly the roles that have it in their settings (sign-off goes only to that appraisal’s signers)', async () => {
    for (const m of MESSAGES) await notify(m);
    for (const [who, kinds] of Object.entries(EXPECTED)) {
      const r = await callers[who].call('GET', '/api/notifications');
      expect(r.status, who).toBe(200);
      expect((r.body.items as { kind: string }[]).map(n => n.kind).sort(), who).toEqual(broadcast(kinds).sort());
      expect(r.body.unread, who).toBe(broadcast(kinds).length);
    }
  });

  it('lets every role open the page behind each notification it gets', async () => {
    for (const [who, kinds] of Object.entries(EXPECTED)) {
      for (const kind of broadcast(kinds)) {
        const [method, path] = DESTINATION[kind];
        const r = await callers[who].call(method, path);
        expect([401, 403], `${who} → ${kind} (${method} ${path}) answered ${r.status}`).not.toContain(r.status);
      }
    }
  });

  it('lets each role switch off its own notifications — and refuses anything it doesn’t get', async () => {
    for (const [who, kinds] of Object.entries(EXPECTED)) {
      const notMine = ALL.find(k => !expectedFor(who).includes(k));
      const mine = broadcast(kinds);
      if (notMine) expect((await callers[who].call('PUT', '/api/notifications/settings', { muted: [notMine] })).status, `${who} ${notMine}`).toBe(400);
      if (mine.length) {
        expect((await callers[who].call('PUT', '/api/notifications/settings', { muted: [mine[0]] })).status, who).toBe(200);
      }
    }
    for (const m of MESSAGES) await notify(m);
    for (const [who, kinds] of Object.entries(EXPECTED)) {
      const r = await callers[who].call('GET', '/api/notifications');
      // Everything they get except the one they switched off.
      expect((r.body.items as { kind: string }[]).map(n => n.kind).sort(), who).toEqual(broadcast(kinds).slice(1).sort());
    }
  });
});
