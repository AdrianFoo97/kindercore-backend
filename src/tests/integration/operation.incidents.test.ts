import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  incidentReportLogs, incidentReports, incidentReportStudents, leads, packages, studentEnrollments, students, users,
} from '../../db/schema.js';
import {
  addIncidentLog, createIncident, listIncidentStudentOptions, listMyIncidents, todayInMalaysia, updateIncident,
} from '../../controllers/incidents.controller.js';
import { resetTables } from './testDb.js';
import { nextSpy, reqWith, res } from './http.js';
import { requireView } from '../../middlewares/auth.middleware.js';
import { seedPackages, seedStudent } from '../fixtures/students.js';
import { activeUser } from '../fixtures/users.js';

// Incident reports (Operation → Incidents), replacing the Google Form: any
// staff member files one, the Operation module follows it up. Real
// handlers, test DB.

const TEACHER = { id: 'user-teacher', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-1' };
const OTHER = { id: 'user-other', email: 'omar@kindertech.test', role: 'USER', teacherId: 't-2' };
const SUPERVISOR = { id: 'user-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };

let kidA: string;
let kidB: string;

beforeEach(async () => {
  await resetTables(incidentReportLogs, incidentReportStudents, incidentReports, studentEnrollments, students, leads, packages, users);
  await db.insert(users).values([
    await activeUser({ id: TEACHER.id, email: TEACHER.email, name: 'Tina Teacher', role: 'USER' }),
    await activeUser({ id: OTHER.id, email: OTHER.email, name: 'Omar Other', role: 'USER' }),
    await activeUser({ id: SUPERVISOR.id, email: SUPERVISOR.email, name: 'Ada Admin' }),
  ]);
  await seedPackages();
  kidA = await seedStudent({ enrollments: [{ start: '2025-01-01' }] });
  kidB = await seedStudent({ enrollments: [{ start: '2025-01-01' }] });
});
afterAll(async () => {
  await pool.end();
});

const valid = () => ({
  incidentDate: '2026-01-05',
  incidentTime: '10:30',
  location: 'Playground',
  description: 'Fell off the slide and scraped a knee.',
  actionsTaken: 'Cleaned and bandaged the knee, child rested.',
  studentIds: [kidA],
});

const file = async (body: object, user = TEACHER) => {
  const r = res();
  await createIncident(reqWith({ body, user }), r);
  return r;
};
const update = async (id: string, body: object, user = SUPERVISOR) => {
  const r = res();
  await updateIncident(reqWith({ body, params: { id }, user }), r);
  return r;
};
const addLog = async (id: string, body: object, user = SUPERVISOR) => {
  const r = res();
  await addIncidentLog(reqWith({ body, params: { id }, user }), r);
  return r;
};

describe('Operation — filing an incident report', () => {
  it('files a report linked to the children involved, as Open, reported by whoever is signed in', async () => {
    const r = await file({ ...valid(), studentIds: [kidA, kidB] });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ status: 'OPEN', reportedByName: 'Tina Teacher', location: 'Playground' });
    expect(r.body.students.map((s: { studentId: string }) => s.studentId).sort()).toEqual([kidA, kidB].sort());
  });

  it('ignores a typed-in "reported by" — the name always comes from the login', async () => {
    const r = await file({ ...valid(), reportedByName: 'Someone Else', reportedByUserId: OTHER.id });
    expect(r.body).toMatchObject({ reportedByName: 'Tina Teacher', reportedByUserId: TEACHER.id });
  });

  it('refuses a report with no child involved', async () => {
    const r = await file({ ...valid(), studentIds: [], otherChildren: '' });
    expect(r.statusCode).toBe(400);
    expect(await db.select().from(incidentReports)).toHaveLength(0);
  });

  it('accepts a child who is not an enrolled student, named in "other children"', async () => {
    const r = await file({ ...valid(), studentIds: [], otherChildren: 'Visiting sibling' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ otherChildren: 'Visiting sibling', students: [] });
  });

  it('refuses a date in the future or a badly formed time', async () => {
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect((await file({ ...valid(), incidentDate: tomorrow })).statusCode).toBe(400);
    expect((await file({ ...valid(), incidentTime: '25:00' })).statusCode).toBe(400);
    expect((await file({ ...valid(), incidentDate: todayInMalaysia() })).statusCode).toBe(201);
  });

  it('refuses a student who does not exist', async () => {
    const r = await file({ ...valid(), studentIds: ['no-such-student'] });
    expect(r.statusCode).toBe(400);
    expect(await db.select().from(incidentReports)).toHaveLength(0);
  });

  it('keeps the child\'s name as it was when reported, even if the student is renamed later', async () => {
    const r = await file(valid());
    await db.update(students).set({ childName: 'Renamed Child' }).where(eq(students.id, kidA));
    const mine = res();
    await listMyIncidents(reqWith({ user: TEACHER }), mine);
    expect(mine.body[0].students[0].childName).toBe(r.body.students[0].childName);
    expect(mine.body[0].students[0].childName).not.toBe('Renamed Child');
  });
});

describe('Operation — seeing and following up incident reports', () => {
  it('shows a staff member only the reports they filed themselves', async () => {
    await file(valid(), TEACHER);
    await file({ ...valid(), location: 'Classroom 2' }, OTHER);
    const mine = res();
    await listMyIncidents(reqWith({ user: TEACHER }), mine);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].location).toBe('Playground');
  });

  it('offers only current students in the "children involved" picker', async () => {
    await db.update(students).set({ withdrawnAt: new Date() }).where(eq(students.id, kidB));
    const r = res();
    await listIncidentStudentOptions(reqWith({ user: TEACHER }), r);
    expect(r.body.map((s: { id: string }) => s.id)).toEqual([kidA]);
    expect(Object.keys(r.body[0]).sort()).toEqual(['age', 'childName', 'id']);
  });

  it('gives each student\'s age the way the Students page counts it, youngest first', async () => {
    const thisYear = Number(todayInMalaysia().slice(0, 4));
    await db.update(students).set({ childDob: new Date(`${thisYear - 6}-03-01`) }).where(eq(students.id, kidA));
    await db.update(students).set({ childDob: new Date(`${thisYear - 5}-03-01`), ageOffset: -1 }).where(eq(students.id, kidB));
    const r = res();
    await listIncidentStudentOptions(reqWith({ user: TEACHER }), r);
    expect(r.body.map((s: { id: string; age: number }) => [s.id, s.age])).toEqual([[kidB, 4], [kidA, 6]]);
  });

  it('can correct the children involved, but not remove every child', async () => {
    const { body: report } = await file(valid());
    const swapped = await update(report.id, { studentIds: [kidB] });
    expect(swapped.body.students.map((s: { studentId: string }) => s.studentId)).toEqual([kidB]);
    expect((await update(report.id, { studentIds: [] })).statusCode).toBe(400);
  });

  it('records a correction in the log, naming what changed and who changed it', async () => {
    const { body: report } = await file(valid());
    const r = await update(report.id, { location: 'Classroom 2', studentIds: [kidA] });
    expect(r.body.location).toBe('Classroom 2');
    expect(r.body.log).toHaveLength(1);
    expect(r.body.log[0]).toMatchObject({ kind: 'EDIT', body: 'Changed location', authorName: 'Ada Admin' });
  });

  it('cannot change the status by editing the details — only through the log', async () => {
    const { body: report } = await file(valid());
    const r = await update(report.id, { status: 'RESOLVED' });
    expect(r.body.status).toBe('OPEN');
  });

  it('answers 404 for a report that does not exist', async () => {
    expect((await update('missing', { location: 'Hall' })).statusCode).toBe(404);
    expect((await addLog('missing', { note: 'Hello' })).statusCode).toBe(404);
  });
});

describe('Operation — the follow-up log', () => {
  it('adds a supervisor\'s comment to the log with who wrote it and when', async () => {
    const { body: report } = await file(valid());
    const r = await addLog(report.id, { note: 'Spoke to the teacher; slide is wet in the mornings.' });
    expect(r.statusCode).toBe(201);
    expect(r.body.status).toBe('OPEN');
    expect(r.body.log).toHaveLength(1);
    expect(r.body.log[0]).toMatchObject({ kind: 'NOTE', body: 'Spoke to the teacher; slide is wet in the mornings.', authorName: 'Ada Admin' });
    expect(new Date(r.body.log[0].createdAt).getTime()).toBeGreaterThan(0);
  });

  it('moves a report to Parent informed, then Resolved, logging each step in order', async () => {
    const { body: report } = await file(valid());
    await addLog(report.id, { status: 'PARENT_INFORMED', note: 'Called mum at 12:00.' });
    const resolved = await addLog(report.id, { status: 'RESOLVED', note: 'Knee healed, no further action.' });
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', statusUpdatedByName: 'Ada Admin' });
    expect(resolved.body.log.map((l: { kind: string; statusFrom: string; statusTo: string; body: string }) =>
      [l.kind, l.statusFrom, l.statusTo, l.body])).toEqual([
      ['STATUS', 'OPEN', 'PARENT_INFORMED', 'Called mum at 12:00.'],
      ['STATUS', 'PARENT_INFORMED', 'RESOLVED', 'Knee healed, no further action.'],
    ]);
  });

  it('refuses an empty log entry — no comment and no status change', async () => {
    const { body: report } = await file(valid());
    expect((await addLog(report.id, { note: '  ' })).statusCode).toBe(400);
    expect((await addLog(report.id, { status: 'OPEN' })).statusCode).toBe(400);
    expect(await db.select().from(incidentReportLogs)).toHaveLength(0);
  });

  it('refuses a status that is not one of the three', async () => {
    const { body: report } = await file(valid());
    expect((await addLog(report.id, { status: 'CLOSED' })).statusCode).toBe(400);
  });

  it('keeps how satisfied the parent was with each comment, so it can be followed over time', async () => {
    const { body: report } = await file(valid());
    await addLog(report.id, { note: 'Called mum — she was fine.', parentReaction: 'SATISFIED' });
    await addLog(report.id, { note: 'Spoke to the class teacher.' });
    const r = await addLog(report.id, { note: 'Mum called back, worried it keeps happening.', parentReaction: 'CONCERNED' });
    expect(r.body.log.map((l: { body: string; parentReaction: string | null }) => [l.body, l.parentReaction])).toEqual([
      ['Called mum — she was fine.', 'SATISFIED'],
      ['Spoke to the class teacher.', null],
      ['Mum called back, worried it keeps happening.', 'CONCERNED'],
    ]);
  });

  it('refuses an unknown satisfaction, or one without a comment to go with it', async () => {
    const { body: report } = await file(valid());
    expect((await addLog(report.id, { note: 'Called.', parentReaction: 'FURIOUS' })).statusCode).toBe(400);
    expect((await addLog(report.id, { parentReaction: 'UPSET' })).statusCode).toBe(400);
    expect((await addLog(report.id, { status: 'PARENT_INFORMED', parentReaction: 'UPSET' })).statusCode).toBe(400);
    expect(await db.select().from(incidentReportLogs)).toHaveLength(0);
  });

  it('lets an Admin manage incidents, but not a staff member without the "Manage incident reports" view', async () => {
    const gate = requireView('OPERATION_INCIDENT_MANAGE');
    const teacherNext = nextSpy();
    const teacherRes = res();
    await gate(reqWith({ user: TEACHER }), teacherRes, teacherNext);
    expect(teacherNext.called).toBe(false);
    expect(teacherRes.statusCode).toBe(403);
    const adminNext = nextSpy();
    await gate(reqWith({ user: SUPERVISOR }), res(), adminNext);
    expect(adminNext.called).toBe(true);
  });

  it('shows the teacher who filed it the follow-up log on their own report', async () => {
    const { body: report } = await file(valid());
    await addLog(report.id, { status: 'PARENT_INFORMED', note: 'Called mum.' });
    const mine = res();
    await listMyIncidents(reqWith({ user: TEACHER }), mine);
    expect(mine.body[0].log).toHaveLength(1);
  });
});
