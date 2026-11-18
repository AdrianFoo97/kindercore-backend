import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { appraisalScoringForms, positions } from '../../db/schema.js';
import {
  createAppraisalScoringForm, deleteAppraisalScoringForm, getAppraisalScoringForm, listAppraisalScoringForms,
  setAppraisalScoringFormActive, updateAppraisalScoringForm,
} from '../../controllers/appraisal-scoring-forms.controller.js';
import { positionRows } from '../fixtures/permissions.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Settings → Scoring forms: reusable "What's scored" bodies — weighted
// sections and criteria, built like an appraisal form's (no "who appraises",
// no "how often") — that an appraisal criterion can be scored from. Real
// handlers, test DB.

const call = async (handler: (rq: any, rs: any) => Promise<void>, params: Record<string, string> = {}, body: unknown = {}) => {
  const r = res();
  await handler(reqWith({ params, body }), r);
  return r;
};
const classroomCare = (name = 'Classroom care') => ({
  name,
  sections: [
    { name: 'Care', weight: 60, criteria: [
      { name: 'Patience', weight: 50, inputType: 'RATING', scaleConfig: { max: 5 } },
      { name: 'Washes hands', weight: 50, inputType: 'YES_NO' },
    ] },
    { name: 'Safety', weight: 40, criteria: [
      { name: 'Head counts missed', weight: 100, inputType: 'NUMBER', scaleConfig: { target: 1, higherIsBetter: false } },
    ] },
  ],
});

beforeEach(async () => {
  await resetTables(appraisalScoringForms, positions);
  await db.insert(positions).values(positionRows);
});
afterAll(async () => { await pool.end(); });

describe('Appraisal scoring forms', () => {
  it('starts with a name, then saves weighted sections and criteria like an appraisal form', async () => {
    const created = await call(createAppraisalScoringForm, {}, { name: 'Classroom care' });
    expect(created.statusCode).toBe(201);
    expect(created.body).toMatchObject({ name: 'Classroom care', sections: [] });
    const saved = await call(updateAppraisalScoringForm, { id: created.body.id }, classroomCare());
    expect(saved.statusCode).toBe(200);
    expect(saved.body.sections.map((s: any) => [s.name, s.weight, s.criteria.map((c: any) => [c.name, c.inputType])])).toEqual([
      ['Care', 60, [['Patience', 'RATING'], ['Washes hands', 'YES_NO']]],
      ['Safety', 40, [['Head counts missed', 'NUMBER']]],
    ]);
    expect(saved.body.problems).toEqual([]);
    expect((await call(getAppraisalScoringForm, { id: created.body.id })).body.name).toBe('Classroom care');
    expect((await call(listAppraisalScoringForms)).body.map((f: any) => f.name)).toEqual(['Classroom care']);
  });

  it('says what stops it being used, with the same checks as an appraisal form', async () => {
    const form = (await call(createAppraisalScoringForm, {}, { name: 'Draft' })).body;
    expect(form.problems).toContain('Add at least one section.');
    const short = classroomCare();
    short.sections[1].weight = 30;
    expect((await call(updateAppraisalScoringForm, { id: form.id }, short)).body.problems).toEqual(['Section weights add up to 90% — they need to make 100%.']);
  });

  it('refuses weights over 100%, a number without a target, or a scoring form inside it — and keeps "on several points" for SOP steps only', async () => {
    const form = (await call(createAppraisalScoringForm, {}, { name: 'Draft' })).body;
    const over = classroomCare();
    over.sections[0].weight = 80;
    expect((await call(updateAppraisalScoringForm, { id: form.id }, over)).statusCode).toBe(400);
    const noTarget = classroomCare();
    (noTarget.sections[1].criteria[0] as any).scaleConfig = undefined;
    expect((await call(updateAppraisalScoringForm, { id: form.id }, noTarget)).statusCode).toBe(400);
    // Never a scoring form inside a scoring form.
    const nested = classroomCare();
    (nested.sections[1].criteria[0] as any).inputType = 'FORM';
    expect((await call(updateAppraisalScoringForm, { id: form.id }, nested)).statusCode).toBe(400);
    // "On several points" saves (it's how an SOP's steps are kept) but can't be used unless every item is pass / fail / N/A.
    const points = classroomCare();
    Object.assign(points.sections[1].criteria[0] as any, { inputType: 'POINTS', points: [{ name: 'Cares', inputType: 'YES_NO' }] });
    const saved = await call(updateAppraisalScoringForm, { id: form.id }, points);
    expect(saved.statusCode).toBe(200);
    expect((saved.body as { problems: string[] }).problems.some(p => p.includes('no longer offered'))).toBe(true);
    Object.assign(points.sections[1].criteria[0] as any, { points: [{ name: 'Greet', inputType: 'PASS_FAIL' }, { name: 'Check in', inputType: 'PASS_FAIL' }] });
    expect((await call(updateAppraisalScoringForm, { id: form.id }, points)).body).toMatchObject({ problems: [] });
  });

  it('can say which positions it is for — optional, and only positions that exist', async () => {
    const form = (await call(createAppraisalScoringForm, {}, { name: 'Draft' })).body;
    expect(form.positionIds).toEqual([]);
    expect((await call(updateAppraisalScoringForm, { id: form.id }, { ...classroomCare(), positionIds: ['P-CT', 'P-CT'] })).body.positionIds).toEqual(['P-CT']);
    expect((await call(updateAppraisalScoringForm, { id: form.id }, { ...classroomCare(), positionIds: ['P-GHOST'] })).statusCode).toBe(400);
    expect((await call(updateAppraisalScoringForm, { id: form.id }, classroomCare())).body.positionIds).toEqual([]);
  });

  it('can be made inactive and active again', async () => {
    const form = (await call(createAppraisalScoringForm, {}, { name: 'Classroom care' })).body;
    expect(form.isActive).toBe(true);
    expect((await call(setAppraisalScoringFormActive, { id: form.id }, { active: false })).body.isActive).toBe(false);
    expect((await call(setAppraisalScoringFormActive, { id: form.id }, { active: true })).body.isActive).toBe(true);
    expect((await call(setAppraisalScoringFormActive, { id: 'nope' }, { active: true })).statusCode).toBe(404);
  });

  it('can be renamed and deleted', async () => {
    const form = (await call(createAppraisalScoringForm, {}, { name: 'Draft' })).body;
    expect((await call(updateAppraisalScoringForm, { id: form.id }, classroomCare('Care'))).body.name).toBe('Care');
    expect((await call(deleteAppraisalScoringForm, { id: form.id })).statusCode).toBe(204);
    expect((await call(deleteAppraisalScoringForm, { id: form.id })).statusCode).toBe(404);
  });
});

describe('Appraisal scoring forms — SOP steps marked on levels', () => {
  const sopForm = (levels: unknown) => ({
    name: 'SOP Audit', positionIds: [], sopTemplateIds: ['sop-gate'],
    sections: [{ name: 'SOPs', weight: 100, criteria: [{ name: 'Gate Duty', description: null, weight: 100, inputType: 'POINTS', scaleConfig: null, sopTemplateId: 'sop-gate',
      points: ['Open the gate', 'Greet parents'].map(name => ({ name, inputType: 'LEVELS', scaleConfig: { levels, source: { kind: 'CUSTOM' } } })) }] }],
  });
  const custom = [{ label: 'Fail', score: 0 }, { label: 'Satisfactory', score: 60 }, { label: 'Excellent', score: 100 }];

  it('saves an SOP form whose steps are marked on its own levels (with N/A), and refuses levels that don’t make sense', async () => {
    const created = await call(createAppraisalScoringForm, {}, { name: 'SOP Audit' });
    const saved = await call(updateAppraisalScoringForm, { id: created.body.id }, sopForm(custom));
    expect(saved.statusCode).toBe(200);
    const point = saved.body.sections[0].criteria[0].points[0];
    expect(point).toMatchObject({ inputType: 'LEVELS', scaleConfig: { levels: custom } });
    expect(saved.body.sections[0].criteria[0].sopTemplateId).toBe('sop-gate'); // remembers its SOP
    expect(saved.body.problems).toEqual([]);
    expect((await call(updateAppraisalScoringForm, { id: created.body.id }, sopForm([{ label: 'Only', score: 50 }]))).statusCode).toBe(400);
    expect((await call(updateAppraisalScoringForm, { id: created.body.id }, sopForm([{ label: 'Low', score: 0 }, { label: 'Too much', score: 150 }]))).statusCode).toBe(400);
    expect((await call(updateAppraisalScoringForm, { id: created.body.id }, sopForm([{ label: 'Same', score: 0 }, { label: 'same', score: 100 }]))).statusCode).toBe(400);
  });
});
