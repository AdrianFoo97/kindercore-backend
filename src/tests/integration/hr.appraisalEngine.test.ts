import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  appraisalCriteria, appraisalScores, appraisalSections, appraisalTemplates, appraisals, teacherAppraisals, teachers, users, positions, departments,
} from '../../db/schema.js';
import { LEGACY_TEMPLATE_ID, syncLegacyAppraisals } from '../../services/appraisalLegacy.service.js';
import { updateTeacher } from '../../controllers/planner.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// The appraisal template engine, step 1: appraisals from before the engine are
// mirrored onto a "Legacy overall score" template with identical totals, and
// staff records gain "reports to" (who may appraise whom). Real handlers, test DB.

const NOW = new Date('2026-11-01T00:00:00Z');
const HR = { id: 'user-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
const NOT_HR = { id: 'user-plain', email: 'plain@kindertech.test', role: 'USER', teacherId: 't-tina' };
const staff = (id: string, name: string) => ({ id, name, color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
const old = (id: string, teacherId: string, month: number, score: number) => ({
  id, teacherId, year: 2026, month, score, notes: `note ${id}`, evaluatedBy: 'Ada Admin', createdAt: NOW, updatedAt: NOW,
});

beforeEach(async () => {
  await resetTables(appraisalScores, appraisals, appraisalCriteria, appraisalSections, appraisalTemplates, teacherAppraisals, teachers, users);
  await db.insert(users).values([
    await activeUser({ id: HR.id, email: HR.email, name: 'Ada Admin' }),
    await activeUser({ id: NOT_HR.id, email: NOT_HR.email, name: 'Tina Teacher', role: 'USER', teacherId: 't-tina' }),
  ]);
  await db.insert(teachers).values([staff('t-tina', 'Tina'), staff('t-sam', 'Sam'), staff('t-pat', 'Pat')]);
});
afterAll(async () => {
  await pool.end();
});

describe('Appraisal engine — appraisals from before templates', () => {
  it('copies every old appraisal onto the legacy template with the same score, month and assessor', async () => {
    await db.insert(teacherAppraisals).values([old('a1', 't-tina', 9, 82.5), old('a2', 't-sam', 9, 70)]);
    expect(await syncLegacyAppraisals()).toEqual({ added: 2, updated: 0, removed: 0 });

    const copies = await db.select().from(appraisals);
    expect(copies.map(c => [c.legacyAppraisalId, c.teacherId, c.periodYear, c.periodMonth, c.totalScore, c.status, c.templateId]).sort())
      .toEqual([
        ['a1', 't-tina', 2026, 9, 82.5, 'COMPLETED', LEGACY_TEMPLATE_ID],
        ['a2', 't-sam', 2026, 9, 70, 'COMPLETED', LEGACY_TEMPLATE_ID],
      ]);
    expect((await db.select().from(appraisalScores)).map(s => s.normalised).sort()).toEqual([70, 82.5]);
    const [tpl] = await db.select().from(appraisalTemplates).where(eq(appraisalTemplates.id, LEGACY_TEMPLATE_ID));
    expect(tpl).toMatchObject({ isLegacy: true, name: 'Legacy overall score' });
  });

  it('is safe to run again, and follows later edits and deletions of the old appraisals', async () => {
    await db.insert(teacherAppraisals).values([old('a1', 't-tina', 9, 82.5), old('a2', 't-sam', 9, 70)]);
    await syncLegacyAppraisals();
    expect(await syncLegacyAppraisals()).toEqual({ added: 0, updated: 0, removed: 0 });

    await db.update(teacherAppraisals).set({ score: 90 }).where(eq(teacherAppraisals.id, 'a1'));
    await db.delete(teacherAppraisals).where(eq(teacherAppraisals.id, 'a2'));
    expect(await syncLegacyAppraisals()).toEqual({ added: 0, updated: 1, removed: 1 });
    const copies = await db.select().from(appraisals);
    expect(copies).toHaveLength(1);
    expect(copies[0].totalScore).toBe(90);
    expect(await db.select().from(appraisalScores)).toHaveLength(1);
  });
});

describe('Staff record — reports to', () => {
  // Academic: Junior EI (Tina) < Supervisor (Sam). Management: Principal (Pat).
  beforeEach(async () => {
    await resetTables(positions, departments);
    await db.insert(departments).values([
      { departmentId: 'ACAD', name: 'Academic', sortOrder: 0, isManagement: false, createdAt: NOW, updatedAt: NOW },
      { departmentId: 'MGMT', name: 'Management', sortOrder: 1, isManagement: true, createdAt: NOW, updatedAt: NOW },
      { departmentId: 'SUP', name: 'Support', sortOrder: 2, isManagement: false, createdAt: NOW, updatedAt: NOW },
    ] as never);
    await db.insert(positions).values([
      { positionId: 'EI', name: 'Junior EI', departmentId: 'ACAD', titleWeight: 2, createdAt: NOW, updatedAt: NOW },
      { positionId: 'SV', name: 'Supervisor', departmentId: 'ACAD', titleWeight: 4, createdAt: NOW, updatedAt: NOW },
      { positionId: 'EP', name: 'Principal', departmentId: 'MGMT', titleWeight: 6, createdAt: NOW, updatedAt: NOW },
      { positionId: 'OM', name: 'Office Admin', departmentId: 'SUP', titleWeight: 9, createdAt: NOW, updatedAt: NOW },
    ] as never);
    await db.update(teachers).set({ positionId: 'EI' }).where(eq(teachers.id, 't-tina'));
    await db.update(teachers).set({ positionId: 'SV' }).where(eq(teachers.id, 't-sam'));
    await db.update(teachers).set({ positionId: 'EP' }).where(eq(teachers.id, 't-pat'));
  });
  const setManager = async (id: string, reportsToTeacherId: string | null, user = HR) => {
    const r = res();
    await updateTeacher(reqWith({ params: { id }, body: { reportsToTeacherId }, user }), r);
    return r;
  };

  it('records who a staff member reports to — someone higher in their department, or anyone in Management', async () => {
    expect((await setManager('t-tina', 't-sam')).statusCode).toBe(200);
    expect((await db.select().from(teachers).where(eq(teachers.id, 't-tina')))[0].reportsToTeacherId).toBe('t-sam');
    expect((await setManager('t-tina', 't-pat')).statusCode).toBe(200); // the Principal (Management)
    expect((await setManager('t-sam', 't-tina')).statusCode).toBe(400); // lower-ranked
  });

  it('must be filled in — only Management staff report to nobody', async () => {
    const cleared = await setManager('t-tina', null);
    expect(cleared.statusCode).toBe(400);
    expect(cleared.body.message).toMatch(/only Management staff can report to nobody/);
    expect((await setManager('t-pat', null)).statusCode).toBe(200);
  });

  it('refuses someone in another department who isn’t in Management', async () => {
    await db.insert(teachers).values({ id: 't-olga', name: 'Olga', color: '#7c3aed', positionId: 'OM', createdAt: NOW, updatedAt: NOW });
    expect((await setManager('t-tina', 't-olga')).statusCode).toBe(400); // higher title weight, but Support isn't Management
  });

  it('refuses someone reporting to themselves, to nobody real, or in a loop', async () => {
    expect((await setManager('t-tina', 't-tina')).statusCode).toBe(400);
    expect((await setManager('t-tina', 'ghost')).statusCode).toBe(400);
    await setManager('t-tina', 't-sam');
    await setManager('t-sam', 't-pat');
    const loop = await setManager('t-pat', 't-tina'); // Pat → Tina → Sam → Pat
    expect(loop.statusCode).toBe(400);
    expect(loop.body.message).toMatch(/loop/);
  });

  it('lets only HR change who someone reports to', async () => {
    const r = await setManager('t-tina', 't-sam', NOT_HR);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/reportsToTeacherId/);
  });
});
