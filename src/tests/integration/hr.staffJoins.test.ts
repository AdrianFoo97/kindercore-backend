import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  allowanceTypes, candidates, careerRecords, positions, staffJoinRequests, teacherAllowances, teachers, users,
} from '../../db/schema.js';
import { approveStaffJoin, rejectStaffJoin, submitStaffJoin } from '../../controllers/staff-joins.controller.js';
import { hireCandidate } from '../../controllers/candidates.controller.js';
import { resetTables } from './testDb.js';
import { req, reqWith, res } from './http.js';
import { positionRows } from '../fixtures/permissions.js';

// New staff who skipped Recruitment fill in the public "New staff" form;
// HR approves it into a staff record, exactly as Recruitment → Hire does.

const NOW = new Date('2026-01-01T00:00:00Z');
const HR = { id: 'u-hr', email: 'hr@kindertech.test', role: 'USER', teacherId: null };

const FORM = { fullName: 'Aisyah Rahman', phone: '0123456789', dob: '1998-04-12', email: 'Aisyah.Rahman@Gmail.com' };
const HIRE_DETAILS = {
  phone: '0123456789', positionId: 'P-CT', level: 1, employmentType: 'full-time', joinDate: '2026-02-01',
  salaryType: 'fixed', fixedSalaryAmount: 2800, hasEpf: true, hasSocso: true, hasEis: true,
  allowances: [{ allowanceTypeId: 'al-kpi', amount: 150 }, { allowanceTypeId: 'al-gone', amount: 99 }],
};

beforeEach(async () => {
  await resetTables(staffJoinRequests, teacherAllowances, careerRecords, teachers, candidates, allowanceTypes, positions, users);
  await db.insert(positions).values(positionRows);
  await db.insert(allowanceTypes).values({ id: 'al-kpi', name: 'KPI', createdAt: NOW });
  await db.insert(users).values({
    id: HR.id, email: HR.email, name: 'Hana HR', passwordHash: 'x', role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW,
  });
});
afterAll(async () => { await pool.end(); });

async function submit(body: object) {
  const r = res();
  await submitStaffJoin(req(body), r);
  return r;
}
async function pendingId() {
  await submit(FORM);
  return (await db.select().from(staffJoinRequests))[0].id;
}
async function approve(id: string, body: object = HIRE_DETAILS) {
  const r = res();
  await approveStaffJoin(reqWith({ params: { id }, body, user: HR }), r);
  return r;
}

describe('HR — new staff form', () => {
  it('saves a submitted form as waiting for HR, and sends nothing back', async () => {
    const r = await submit(FORM);
    expect(r.statusCode).toBe(201);
    expect(r.body).toEqual({ ok: true });
    const [row] = await db.select().from(staffJoinRequests);
    expect(row).toMatchObject({ fullName: 'Aisyah Rahman', email: 'aisyah.rahman@gmail.com', status: 'PENDING', teacherId: null });
  });

  it('refuses a form with missing details, a future birth date, or the hidden spam field filled', async () => {
    expect((await submit({ ...FORM, phone: '' })).statusCode).toBe(400);
    expect((await submit({ ...FORM, email: '' })).statusCode).toBe(400);
    expect((await submit({ ...FORM, dob: '2099-01-01' })).statusCode).toBe(400);
    expect((await submit({ ...FORM, company: 'Spam Sdn Bhd' })).statusCode).toBe(400);
    expect(await db.select().from(staffJoinRequests)).toHaveLength(0);
  });

  it('does not put the same person in the queue twice while they are waiting', async () => {
    await submit(FORM);
    expect((await submit(FORM)).statusCode).toBe(409);
    expect(await db.select().from(staffJoinRequests)).toHaveLength(1);
  });
});

describe('HR — approving a new staff member', () => {
  it('adds them to the staff list with their own name, phone and birth date', async () => {
    const id = await pendingId();
    const r = await approve(id);
    expect(r.statusCode).toBe(201);

    const [teacher] = await db.select().from(teachers);
    expect(teacher).toMatchObject({ name: 'Aisyah Rahman', phone: '0123456789', positionId: 'P-CT', level: 1, salaryType: 'fixed', fixedSalaryAmount: 2800 });
    expect(teacher.dob?.toISOString().slice(0, 10)).toBe('1998-04-12');
    expect(teacher.createdAt.toISOString().slice(0, 10)).toBe('2026-02-01');

    const [request] = await db.select().from(staffJoinRequests).where(eq(staffJoinRequests.id, id));
    expect(request).toMatchObject({ status: 'APPROVED', teacherId: teacher.id, reviewedByName: 'Hana HR' });
  });

  it('starts their career history and allowances, ignoring an allowance type that no longer exists', async () => {
    await approve(await pendingId());
    const [teacher] = await db.select().from(teachers);
    expect(await db.select().from(careerRecords).where(eq(careerRecords.teacherId, teacher.id))).toHaveLength(1);
    const allowances = await db.select().from(teacherAllowances).where(eq(teacherAllowances.teacherId, teacher.id));
    expect(allowances.map(a => [a.allowanceTypeId, a.amount])).toEqual([['al-kpi', 150]]);
  });

  it('adds them only once, even if HR clicks Approve twice at the same time', async () => {
    const id = await pendingId();
    const [a, b] = await Promise.all([approve(id), approve(id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await db.select().from(teachers)).toHaveLength(1);
  });

  it('refuses an unknown position and leaves the request waiting', async () => {
    const id = await pendingId();
    expect((await approve(id, { ...HIRE_DETAILS, positionId: 'P-NOPE' })).statusCode).toBe(400);
    expect(await db.select().from(teachers)).toHaveLength(0);
    const [request] = await db.select().from(staffJoinRequests);
    expect(request.status).toBe('PENDING');
  });

  it('rejecting keeps the reason, adds nobody, and cannot then be approved', async () => {
    const id = await pendingId();
    const r = res();
    await rejectStaffJoin(reqWith({ params: { id }, body: { reason: 'Not joining after all' }, user: HR }), r);
    expect(r.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Not joining after all', reviewedByName: 'Hana HR' });
    expect((await approve(id)).statusCode).toBe(409);
    expect(await db.select().from(teachers)).toHaveLength(0);
  });
});

describe('Recruitment — hiring a candidate', () => {
  it('creates the staff record the same way as approving a new staff form', async () => {
    await db.insert(candidates).values({ id: 'c-1', submittedAt: NOW, fullName: 'Ben Lim', phone: '0198765432', status: 'OFFER_SENT' });
    const r = res();
    await hireCandidate(reqWith({ params: { id: 'c-1' }, body: HIRE_DETAILS, user: HR }), r);
    expect(r.statusCode).toBe(201);
    const [teacher] = await db.select().from(teachers);
    expect(teacher).toMatchObject({ name: 'Ben Lim', positionId: 'P-CT', fixedSalaryAmount: 2800 });
    expect(await db.select().from(careerRecords)).toHaveLength(1);
    const [candidate] = await db.select().from(candidates);
    expect(candidate.status).toBe('HIRED');
  });
});
