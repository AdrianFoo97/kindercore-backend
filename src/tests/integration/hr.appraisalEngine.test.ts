import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  appraisalCriteria, appraisalScores, appraisalSections, appraisalTemplates, appraisals, teacherAppraisals, teachers, users,
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
  const setManager = async (id: string, reportsToTeacherId: string | null, user = HR) => {
    const r = res();
    await updateTeacher(reqWith({ params: { id }, body: { reportsToTeacherId }, user }), r);
    return r;
  };

  it('records who a staff member reports to, and can clear it', async () => {
    expect((await setManager('t-tina', 't-sam')).statusCode).toBe(200);
    expect((await db.select().from(teachers).where(eq(teachers.id, 't-tina')))[0].reportsToTeacherId).toBe('t-sam');
    await setManager('t-tina', null);
    expect((await db.select().from(teachers).where(eq(teachers.id, 't-tina')))[0].reportsToTeacherId).toBeNull();
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
