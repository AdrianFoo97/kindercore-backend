import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { teachers, sopTemplates, sopSteps, sopObservations, sopObservationStepResults, systemSettings } from '../../db/schema.js';
import { advanceStage, createObservation, getObservation, getTeacherTraining, recordTrainingGiven, saveObservationMarking, sendBackForTraining } from '../../controllers/sop-observations.controller.js';
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

describe('HR — practice observations marked on levels', () => {
  const call = async (handler: (rq: any, rs: any) => Promise<void>, body: unknown, params: Record<string, string> = {}) => {
    const r = res();
    await handler(reqWith({ body, params, user: ADMIN }), r);
    return r;
  };
  const LEVELS = { inputType: 'LEVELS', levels: [{ label: 'Fail', score: 0 }, { label: 'Satisfactory', score: 60 }, { label: 'Excellent', score: 100 }], passMark: 60 };
  beforeEach(async () => {
    await resetTables(systemSettings);
    await db.insert(teachers).values({ id: 't-tr', name: 'Alicia', color: '#7c3aed', createdAt: NOW, updatedAt: NOW });
    await db.insert(systemSettings).values({ id: 'set-1', key: 'observation_step_marking', value: LEVELS, updatedAt: NOW });
    await db.delete(sopObservationStepResults);
    await db.delete(sopObservations);
  });
  afterAll(async () => { await resetTables(systemSettings); });

  it('keeps the levels from Settings on each observation, and certifies only with every step at the pass mark or above', async () => {
    const made = await call(createObservation, { teacherId: 't-1', sopTemplateId: 'sop-1', trainerId: 't-tr' });
    expect(made.statusCode).toBe(200);
    // A later change to the setting doesn't touch it.
    await db.update(systemSettings).set({ value: { inputType: 'PASS_FAIL' } }).where(eq(systemSettings.key, 'observation_step_marking'));
    const id = made.body.id;
    await call(advanceStage, { trainerName: 'Alicia', trainerAt: '2026-01-05' }, { id });
    const signOff = (stepResults: unknown) => call(advanceStage, { assessorName: 'Lim', assessorAt: '2026-01-10', stepResults }, { id });
    // Satisfactory + Fail: below the pass mark → not certified; it goes back for more training, the level kept.
    expect((await signOff([{ stepId: 'step-1', level: 1 }, { stepId: 'step-2', level: 0 }])).statusCode).toBe(400);
    const back = await call(sendBackForTraining, { stepResults: [{ stepId: 'step-1', level: 1 }, { stepId: 'step-2', level: 0, note: 'Missed it' }] }, { id });
    expect(back.body.status).toBe('PENDING_TRAINER');
    const [failed] = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.sopStepId, 'step-2'));
    expect(failed).toMatchObject({ passed: 'FAIL', level: 0, note: 'Missed it' });
    // Retrained: Satisfactory + Excellent → certified (still on its levels, though the setting is pass / fail now).
    await call(advanceStage, { trainerName: 'Alicia', trainerAt: '2026-01-12' }, { id });
    const ok = await signOff([{ stepId: 'step-1', level: 1 }, { stepId: 'step-2', level: 2 }]);
    expect(ok.body.status).toBe('CERTIFIED');
    const rows = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.observationId, id));
    expect(Object.fromEntries(rows.map(r => [r.sopStepId, [r.passed, r.level]]))).toEqual({ 'step-1': ['PASS', 1], 'step-2': ['PASS', 2] });
  });

  it('saves how new observations are marked, and refuses levels or a pass mark that don’t make sense', async () => {
    const ok = await call(saveObservationMarking, LEVELS);
    expect(ok.statusCode).toBe(200);
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'observation_step_marking'));
    expect(row.value).toMatchObject({ inputType: 'LEVELS', passMark: 60 });
    expect((await call(saveObservationMarking, { inputType: 'PASS_FAIL' })).statusCode).toBe(200);
    expect((await call(saveObservationMarking, { ...LEVELS, levels: [{ label: 'Only', score: 50 }] })).statusCode).toBe(400);
    expect((await call(saveObservationMarking, { ...LEVELS, passMark: 101 })).statusCode).toBe(400);
    expect((await call(saveObservationMarking, { ...LEVELS, levels: [{ label: 'Low', score: 0 }, { label: 'Mid', score: 40 }], passMark: 60 })).statusCode).toBe(400); // no level reaches it
  });

  it('refuses a level the observation doesn’t have', async () => {
    const made = await call(createObservation, { teacherId: 't-1', sopTemplateId: 'sop-1', trainerId: 't-tr' });
    await call(advanceStage, { trainerName: 'Alicia', trainerAt: '2026-01-05' }, { id: made.body.id });
    expect((await call(advanceStage, { assessorName: 'Lim', assessorAt: '2026-01-10', stepResults: [{ stepId: 'step-1', level: 9 }] }, { id: made.body.id })).statusCode).toBe(400);
  });
});

describe('HR — practice observations: steps added to the guide later', () => {
  const call = async (handler: (rq: any, rs: any) => Promise<void>, body: unknown, params: Record<string, string> = {}) => {
    const r = res();
    await handler(reqWith({ body, params, user: ADMIN }), r);
    return r;
  };
  it('shows a step added to the guide after it was assigned, saves its mark, and only takes this guide’s steps', async () => {
    await advance(trainerSignOff);
    await db.insert(sopSteps).values({ id: 'step-3', sopTemplateId: 'sop-1', section: 'Main', title: 'Wave goodbye', displayOrder: 3, createdAt: NOW, updatedAt: NOW });
    const shown = await call(getObservation, {}, { id: OBS });
    expect(shown.body.stepResults.map((r: any) => r.sopStepId)).toEqual(['step-1', 'step-2', 'step-3']);
    const all = ['step-1', 'step-2', 'step-3'].map(stepId => ({ stepId, passed: 'PASS' }));
    await db.insert(sopTemplates).values({ id: 'sop-2', title: 'Other guide', createdAt: NOW, updatedAt: NOW });
    await db.insert(sopSteps).values({ id: 'other-1', sopTemplateId: 'sop-2', section: 'Main', title: 'Not this one', createdAt: NOW, updatedAt: NOW });
    expect((await call(advanceStage, { ...assessorSignOff, stepResults: [...all, { stepId: 'other-1', passed: 'PASS' }] }, { id: OBS })).statusCode).toBe(400);
    expect((await call(advanceStage, { ...assessorSignOff, stepResults: all }, { id: OBS })).body.status).toBe('CERTIFIED');
    const rows = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.observationId, OBS));
    expect(rows.map(r => r.sopStepId).sort()).toEqual(['step-1', 'step-2', 'step-3']);
  });
});
