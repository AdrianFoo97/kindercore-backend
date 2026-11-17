import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { teachers, sopTemplates, sopSteps, sopObservations, sopObservationStepResults } from '../../db/schema.js';
import { advanceStage, createObservation, getTeacherTraining, recordTrainingGiven, sendBackForTraining } from '../../controllers/sop-observations.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Called as an admin — these check the sign-off steps; who may see whom is in hr.performanceTeam.test.
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
const req = (body: unknown, params: Record<string, string>) => reqWith({ body, params, user: ADMIN });

// Practice observations (HR → Practice Observations): a teacher is observed
// doing a how-to guide and signed off in two stages — trainer, then
// assessor (who marks each step) — ending CERTIFIED. Real handler, test DB.

const NOW = new Date('2026-01-01T00:00:00Z');
const OBS = 'obs-1';

beforeEach(async () => {
  await resetTables(sopObservationStepResults, sopObservations, sopSteps, sopTemplates, teachers);
  await db.insert(teachers).values({ id: 't-1', name: 'Tina', color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopTemplates).values({ id: 'sop-1', title: 'Morning drop-off', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopSteps).values([
    { id: 'step-1', sopTemplateId: 'sop-1', section: 'Main', title: 'Greet the parent', createdAt: NOW, updatedAt: NOW },
    { id: 'step-2', sopTemplateId: 'sop-1', section: 'Main', title: 'Health check', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(sopObservations).values({ id: OBS, teacherId: 't-1', sopTemplateId: 'sop-1', status: 'PENDING_TRAINER', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopObservationStepResults).values([
    { id: 'r-1', observationId: OBS, sopStepId: 'step-1', passed: 'NA', createdAt: NOW, updatedAt: NOW },
    { id: 'r-2', observationId: OBS, sopStepId: 'step-2', passed: 'NA', createdAt: NOW, updatedAt: NOW },
  ]);
});
afterAll(async () => {
  await pool.end();
});

const advance = async (body: object) => {
  const r = res();
  await advanceStage(req(body, { id: OBS }), r);
  return r;
};
const trainerSignOff = { trainerName: 'Trainer Tan', trainerAt: '2026-01-05' };
const assessorSignOff = {
  assessorName: 'Assessor Lim', assessorAt: '2026-01-10',
  stepResults: [{ stepId: 'step-1', passed: 'PASS' }, { stepId: 'step-2', passed: 'NA', note: 'No child unwell today' }],
};

describe('HR — practice observation sign-off', () => {
  it('moves to the assessor stage once the trainer signs off, recording who and when', async () => {
    const r = await advance(trainerSignOff);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ status: 'PENDING_ASSESSOR', trainerName: 'Trainer Tan' });
  });

  it('refuses the trainer sign-off without the trainer\'s name', async () => {
    const r = await advance({ trainerAt: '2026-01-05' });
    expect(r.statusCode).toBe(400);
    const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, OBS));
    expect(row.status).toBe('PENDING_TRAINER');
  });

  it('cannot skip straight to the assessor\'s marking', async () => {
    // Sending assessor data while still at the trainer stage is rejected.
    const r = await advance(assessorSignOff);
    expect(r.statusCode).toBe(400);
  });

  it('certifies after the assessor signs off with nothing failed, and records each step\'s mark', async () => {
    await advance(trainerSignOff);
    const r = await advance(assessorSignOff);
    expect(r.body).toMatchObject({ status: 'CERTIFIED', assessorName: 'Assessor Lim' });
    const results = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.observationId, OBS));
    expect(Object.fromEntries(results.map(x => [x.sopStepId, x.passed]))).toEqual({ 'step-1': 'PASS', 'step-2': 'NA' });
    expect(results.find(x => x.sopStepId === 'step-2')?.note).toBe('No child unwell today');
  });

  it('cannot be changed once certified', async () => {
    await advance(trainerSignOff);
    await advance(assessorSignOff);
    const r = await advance(trainerSignOff);
    expect(r.statusCode).toBe(409);
  });

  it('reports a missing observation as not found', async () => {
    const r = res();
    await advanceStage(req(trainerSignOff, { id: 'nope' }), r);
    expect(r.statusCode).toBe(404);
  });
});

describe('Teacher app — the trainer records the training they gave', () => {
  const TRAINER = { id: 'u-tr', email: 'tr@kindertech.test', role: 'USER', teacherId: 't-tr' };
  const record = async (trainedOn: string, user: typeof TRAINER = TRAINER, teacherId = 't-tr') => {
    const r = res();
    await recordTrainingGiven(reqWith({ body: { trainedOn }, params: { teacherId, observationId: OBS }, user }), r);
    return r;
  };
  beforeEach(async () => {
    await db.insert(teachers).values({ id: 't-tr', name: 'Alicia', color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
    await db.update(sopObservations).set({ trainerId: 't-tr' }).where(eq(sopObservations.id, OBS));
  });

  it('moves it to the assessor with the trainer’s own name and the day they trained', async () => {
    const r = await record('2026-01-05');
    expect(r.statusCode).toBe(200);
    const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, OBS));
    expect(row).toMatchObject({ status: 'PENDING_ASSESSOR', trainerName: 'Alicia' });
    expect(row.trainerAt?.toISOString().slice(0, 10)).toBe('2026-01-05');
    expect((await record('2026-01-06')).statusCode).toBe(409); // already recorded
  });

  it('refuses a day in the future, and training they are not the trainer on', async () => {
    expect((await record('2999-01-01')).statusCode).toBe(400);
    expect((await record('not a day')).statusCode).toBe(400);
    expect((await record('2026-01-05', { ...TRAINER, teacherId: 't-1' }, 't-1')).statusCode).toBe(404); // the trainee isn't the trainer
    const [row] = await db.select().from(sopObservations).where(eq(sopObservations.id, OBS));
    expect(row.status).toBe('PENDING_TRAINER');
  });
});

describe('HR — assigning and assessing training safely', () => {
  const call = async (handler: (rq: any, rs: any) => Promise<void>, body: unknown, params: Record<string, string> = {}, user: { id: string; email: string; role: string; teacherId?: string | null } = ADMIN) => {
    const r = res();
    await handler(reqWith({ body, params, user }), r);
    return r;
  };
  beforeEach(async () => {
    await db.insert(teachers).values([
      { id: 't-tr', name: 'Alicia', color: '#7c3aed', createdAt: NOW, updatedAt: NOW },
      { id: 't-gone', name: 'Adrian', color: '#7c3aed', isActive: false, createdAt: NOW, updatedAt: NOW },
    ]);
    await db.insert(sopTemplates).values({ id: 'sop-empty', title: 'Packing', createdAt: NOW, updatedAt: NOW });
  });

  it('refuses training already in progress, a guide with no steps, and someone who has left', async () => {
    const dup = await call(createObservation, { teacherId: 't-1', sopTemplateId: 'sop-1', trainerId: 't-tr' });
    expect(dup.statusCode).toBe(409); // obs-1 is still open for Tina
    expect((await call(createObservation, { teacherId: 't-1', sopTemplateId: 'sop-empty', trainerId: 't-tr' })).statusCode).toBe(400);
    expect((await call(createObservation, { teacherId: 't-tr', sopTemplateId: 'sop-1', trainerId: 't-gone' })).statusCode).toBe(400);
    // Once certified, the same guide can be assigned again (a refresher).
    await advance(trainerSignOff);
    await advance({ ...assessorSignOff, stepResults: [{ stepId: 'step-1', passed: 'PASS' }, { stepId: 'step-2', passed: 'PASS' }] });
    expect((await call(createObservation, { teacherId: 't-1', sopTemplateId: 'sop-1', trainerId: 't-tr' })).statusCode).toBe(200);
  });

  it('won’t certify a failed step or nothing checked — it goes back to the trainer, marks kept', async () => {
    await advance(trainerSignOff);
    const failed = [{ stepId: 'step-1', passed: 'PASS' }, { stepId: 'step-2', passed: 'FAIL', note: 'Missed temperature check' }];
    expect((await advance({ ...assessorSignOff, stepResults: failed })).statusCode).toBe(400);
    expect((await advance({ ...assessorSignOff, stepResults: [{ stepId: 'step-1', passed: 'NA' }, { stepId: 'step-2', passed: 'NA' }] })).statusCode).toBe(400);
    const back = await call(sendBackForTraining, { stepResults: failed }, { id: OBS });
    expect(back.statusCode).toBe(200);
    expect(back.body).toMatchObject({ status: 'PENDING_TRAINER', trainerName: null });
    const [step2] = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.sopStepId, 'step-2'));
    expect(step2).toMatchObject({ passed: 'FAIL', note: 'Missed temperature check' });
  });

  it('never lets someone assess their own training', async () => {
    await advance(trainerSignOff);
    const TINA_ADMIN = { id: 'u-tina', email: 'tina@kindertech.test', role: 'ADMIN', teacherId: 't-1' };
    const ok = { ...assessorSignOff, stepResults: [{ stepId: 'step-1', passed: 'PASS' }, { stepId: 'step-2', passed: 'PASS' }] };
    expect((await call(advanceStage, ok, { id: OBS }, TINA_ADMIN)).statusCode).toBe(403);
    expect((await call(sendBackForTraining, { stepResults: [] }, { id: OBS }, TINA_ADMIN)).statusCode).toBe(403);
  });

  it('shows a staff member’s training only to them, or HR who covers them', async () => {
    const OTHER_HR = { id: 'u-hr2', email: 'hr2@kindertech.test', role: 'USER', teacherId: 't-tr' }; // no team, no see-all
    expect((await call(getTeacherTraining, {}, { teacherId: 't-1' }, OTHER_HR)).statusCode).toBe(403);
    expect((await call(getTeacherTraining, {}, { teacherId: 't-1' }, { id: 'u-tina', email: 't@x.test', role: 'USER', teacherId: 't-1' })).statusCode).toBe(200);
    expect((await call(getTeacherTraining, {}, { teacherId: 't-1' })).statusCode).toBe(200); // admin sees everyone
  });
});
