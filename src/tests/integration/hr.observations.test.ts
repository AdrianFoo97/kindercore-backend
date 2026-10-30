import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { teachers, sopTemplates, sopSteps, sopObservations, sopObservationStepResults } from '../../db/schema.js';
import { advanceStage } from '../../controllers/sop-observations.controller.js';
import { resetTables } from './testDb.js';
import { req, res } from './http.js';

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
  stepResults: [{ stepId: 'step-1', passed: 'PASS' }, { stepId: 'step-2', passed: 'FAIL', note: 'Missed temperature check' }],
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

  it('certifies after the assessor signs off and records each step\'s mark', async () => {
    await advance(trainerSignOff);
    const r = await advance(assessorSignOff);
    expect(r.body).toMatchObject({ status: 'CERTIFIED', assessorName: 'Assessor Lim' });
    const results = await db.select().from(sopObservationStepResults).where(eq(sopObservationStepResults.observationId, OBS));
    expect(Object.fromEntries(results.map(x => [x.sopStepId, x.passed]))).toEqual({ 'step-1': 'PASS', 'step-2': 'FAIL' });
    expect(results.find(x => x.sopStepId === 'step-2')?.note).toBe('Missed temperature check');
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
