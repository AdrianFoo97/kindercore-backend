import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalSections, appraisalStagePositions, appraisalStages, appraisalTemplates, positions,
} from '../../db/schema.js';
import {
  activateAppraisalTemplate, createAppraisalTemplate, deleteAppraisalTemplate, getAppraisalTemplate, listAppraisalTemplates,
  newAppraisalTemplateVersion, retireAppraisalTemplate, setAppraisalTemplatePositions, updateAppraisalTemplate,
} from '../../controllers/appraisal-templates.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { positionRows } from '../fixtures/permissions.js';

// Settings → Appraisal templates: building an appraisal form (weighted
// sections and criteria, who assesses and signs off by position), putting it
// live, and editing it later as a new version. Real handlers, test DB.

const call = async (handler: (rq: any, rs: any) => Promise<void>, params: Record<string, string> = {}, body: unknown = {}) => {
  const r = res();
  await handler(reqWith({ params, body }), r);
  return r;
};

// The example form: 50% core values, 50% KPI; class teachers' supervisor assesses, "helper" signs off.
const complete = (name = 'Monthly teacher appraisal') => ({
  name, description: 'Core values and KPI', frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
  sections: [
    { name: 'Core values', weight: 50, criteria: [
      { name: 'Love for children', weight: 60, inputType: 'RATING', scaleConfig: { max: 5, levels: [{ value: 5, label: 'Outstanding' }] } },
      { name: 'Team spirit', weight: 40, inputType: 'YES_NO' },
    ] },
    { name: 'KPI', weight: 50, criteria: [
      { name: 'Lesson plans on time', weight: 70, inputType: 'PERCENT' },
      { name: 'Late days', weight: 30, inputType: 'NUMBER', scaleConfig: { target: 2, higherIsBetter: false } },
    ] },
  ],
  stages: [
    { name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['P-CT'] },
    { name: 'Signed off by', kind: 'SIGN_OFF', scope: 'ANYONE', positionIds: ['P-NONE'] },
    { name: 'Acknowledged', kind: 'ACKNOWLEDGE', scope: 'ANYONE', positionIds: [] },
  ],
});

const newDraft = async (name?: string) => (await call(createAppraisalTemplate, {}, { name: name ?? 'Monthly teacher appraisal' })).body;

beforeEach(async () => {
  await resetTables(appraisalAssignments, appraisalStagePositions, appraisalStages, appraisalCriterionPoints, appraisalCriteria, appraisalSections, appraisalTemplates, positions);
  await db.insert(positions).values(positionRows);
});
afterAll(async () => { await pool.end(); });

describe('Appraisal templates — building a form', () => {
  it('starts a new form as a draft with the usual assess → sign off → acknowledge chain', async () => {
    const r = await call(createAppraisalTemplate, {}, { name: 'Monthly teacher appraisal' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ status: 'DRAFT', version: 1, frequency: 'MONTHLY', sections: [] });
    expect(r.body.stages.map((s: any) => [s.kind, s.scope])).toEqual([['ASSESS', 'OWN_TEAM'], ['SIGN_OFF', 'ANYONE'], ['ACKNOWLEDGE', 'ANYONE']]);
    expect(r.body.problems).toContain('Add at least one section.');
  });

  it('saves a draft with every kind of input, and lists what still stops it going live', async () => {
    const draft = await newDraft();
    const body = complete();
    body.sections[1].weight = 40;
    const r = await call(updateAppraisalTemplate, { id: draft.id }, body);
    expect(r.statusCode).toBe(200);
    expect(r.body.sections[0].criteria.map((c: any) => [c.name, c.inputType, c.scaleConfig])).toEqual([
      ['Love for children', 'RATING', { max: 5, levels: [{ value: 5, label: 'Outstanding' }] }],
      ['Team spirit', 'YES_NO', null],
    ]);
    expect(r.body.stages[0].positionIds).toEqual(['P-CT']);
    expect(r.body.problems).toEqual(['Section weights add up to 90% — they need to make 100%.']);
  });

  it('lets a criterion be judged on its own points while others are scored directly, and keeps them in new versions', async () => {
    const v1 = await newDraft();
    const body = complete();
    (body.sections[0].criteria[0] as any).points = [{ name: 'Speaks calmly' }, { name: 'Comforts upset children' }];
    const saved = (await call(updateAppraisalTemplate, { id: v1.id }, body)).body;
    expect(saved.sections[0].criteria.map((c: any) => [c.name, c.points.map((p: any) => p.name)])).toEqual([
      ['Love for children', ['Speaks calmly', 'Comforts upset children']],
      ['Team spirit', []],
    ]);
    await call(activateAppraisalTemplate, { id: v1.id });
    const v2 = (await call(newAppraisalTemplateVersion, { id: v1.id })).body;
    expect(v2.sections[0].criteria[0].points.map((p: any) => p.name)).toEqual(['Speaks calmly', 'Comforts upset children']);
    // A point without a name is refused.
    (body.sections[0].criteria[0] as any).points = [{ name: ' ' }];
    expect((await call(updateAppraisalTemplate, { id: v2.id }, body)).statusCode).toBe(400);
  });

  it('refuses weights that add up to more than 100%', async () => {
    const draft = await newDraft();
    const criteriaOver = complete();
    criteriaOver.sections[0].criteria[0].weight = 80; // 80 + 40 = 120
    const r = await call(updateAppraisalTemplate, { id: draft.id }, criteriaOver);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toBe('Criteria in "Core values" add up to more than 100%.');
    const sectionsOver = complete();
    sectionsOver.sections[0].weight = 60;
    expect((await call(updateAppraisalTemplate, { id: draft.id }, sectionsOver)).body.message).toBe('Section weights add up to more than 100%.');
  });

  it('refuses a number criterion without a target, and positions that do not exist', async () => {
    const draft = await newDraft();
    const noTarget = complete();
    noTarget.sections[1].criteria[1].scaleConfig = undefined as any;
    expect((await call(updateAppraisalTemplate, { id: draft.id }, noTarget)).statusCode).toBe(400);
    const ghost = complete();
    ghost.stages[0].positionIds = ['P-GHOST'];
    expect((await call(updateAppraisalTemplate, { id: draft.id }, ghost)).statusCode).toBe(400);
  });
});

describe('Appraisal templates — going live and versions', () => {
  it('puts a complete draft live, and refuses one that still has problems', async () => {
    const draft = await newDraft();
    const refused = await call(activateAppraisalTemplate, { id: draft.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.body.problems).toContain('Add at least one section.');

    await call(updateAppraisalTemplate, { id: draft.id }, complete());
    const live = await call(activateAppraisalTemplate, { id: draft.id });
    expect(live.statusCode).toBe(200);
    expect(live.body.status).toBe('ACTIVE');
  });

  it('never changes a live form — editing opens a new version, and putting it live retires the old one', async () => {
    const v1 = await newDraft();
    await call(updateAppraisalTemplate, { id: v1.id }, complete());
    await call(activateAppraisalTemplate, { id: v1.id });
    expect((await call(updateAppraisalTemplate, { id: v1.id }, complete('Changed'))).statusCode).toBe(409);

    const v2 = (await call(newAppraisalTemplateVersion, { id: v1.id })).body;
    expect(v2).toMatchObject({ status: 'DRAFT', version: 2, familyId: v1.id, activeId: v1.id });
    expect(v2.sections.map((s: any) => s.name)).toEqual(['Core values', 'KPI']);
    // Asking again opens the same draft rather than a third version.
    expect((await call(newAppraisalTemplateVersion, { id: v1.id })).body.id).toBe(v2.id);

    await call(updateAppraisalTemplate, { id: v2.id }, complete('Monthly appraisal 2027'));
    await call(activateAppraisalTemplate, { id: v2.id });
    expect((await call(getAppraisalTemplate, { id: v1.id })).body).toMatchObject({ status: 'RETIRED', name: 'Monthly teacher appraisal' });
    const list = (await call(listAppraisalTemplates)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: v2.id, status: 'ACTIVE', version: 2, sectionCount: 2, criterionCount: 4 });
  });

  it('retires only live forms, and deletes only drafts', async () => {
    const draft = await newDraft();
    expect((await call(retireAppraisalTemplate, { id: draft.id })).statusCode).toBe(409);
    await call(updateAppraisalTemplate, { id: draft.id }, complete());
    await call(activateAppraisalTemplate, { id: draft.id });
    expect((await call(deleteAppraisalTemplate, { id: draft.id })).statusCode).toBe(409);
    expect((await call(retireAppraisalTemplate, { id: draft.id })).body.status).toBe('RETIRED');

    const other = await newDraft('Trial form');
    expect((await call(deleteAppraisalTemplate, { id: other.id })).statusCode).toBe(204);
    expect((await call(getAppraisalTemplate, { id: other.id })).statusCode).toBe(404);
  });
});

describe('Appraisal templates — who uses which form', () => {
  it('gives each position only one form at a time', async () => {
    const a = await newDraft('Teachers');
    const b = await newDraft('Helpers');
    expect((await call(setAppraisalTemplatePositions, { familyId: a.familyId }, { positionIds: ['P-CT'] })).statusCode).toBe(200);
    const clash = await call(setAppraisalTemplatePositions, { familyId: b.familyId }, { positionIds: ['P-CT', 'P-NONE'] });
    expect(clash.statusCode).toBe(409);
    expect(clash.body.message).toMatch(/Teachers/);

    expect((await call(setAppraisalTemplatePositions, { familyId: b.familyId }, { positionIds: ['P-NONE'] })).statusCode).toBe(200);
    expect((await call(getAppraisalTemplate, { id: a.id })).body.positionIds).toEqual(['P-CT']);
    expect((await call(getAppraisalTemplate, { id: b.id })).body.positionIds).toEqual(['P-NONE']);
  });

  it('frees a position from a form that is no longer used', async () => {
    const old = await newDraft('Old form');
    await call(updateAppraisalTemplate, { id: old.id }, complete('Old form'));
    await call(activateAppraisalTemplate, { id: old.id });
    await call(setAppraisalTemplatePositions, { familyId: old.familyId }, { positionIds: ['P-CT'] });
    await call(retireAppraisalTemplate, { id: old.id });

    const fresh = await newDraft('New form');
    expect((await call(setAppraisalTemplatePositions, { familyId: fresh.familyId }, { positionIds: ['P-CT'] })).statusCode).toBe(200);
    expect((await call(getAppraisalTemplate, { id: old.id })).body.positionIds).toEqual([]);
  });
});
