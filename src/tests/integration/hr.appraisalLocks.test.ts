import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalRatingScales, appraisalScoringForms, appraisalSections,
  appraisalStagePositions, appraisalStages, appraisalTemplates, positions,
} from '../../db/schema.js';
import { deleteAppraisalRatingScale, listAppraisalRatingScales, setAppraisalRatingScaleActive } from '../../controllers/appraisal-rating-scales.controller.js';
import { deleteAppraisalScoringForm, listAppraisalScoringForms } from '../../controllers/appraisal-scoring-forms.controller.js';
import { activateTemplate, createTemplate, setFamilyPositions } from '../../services/appraisalTemplates.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Once an appraisal form has been live, the rating scales and scoring forms it
// was built from can't be deleted any more — only made inactive — so it's always
// clear where its criteria came from. Unused ones can still be deleted.

const NOW = new Date('2026-11-01T00:00:00Z');
const call = async (handler: (rq: any, rs: any) => Promise<void>, params: Record<string, string> = {}, body: unknown = {}) => {
  const r = res();
  await handler(reqWith({ params, body }), r);
  return r;
};
const levels = [{ value: 1, label: 'Low' }, { value: 2, label: 'Mid' }, { value: 3, label: 'High' }];
const scale = (id: string, name: string, isDefault = false) => ({ id, name, max: 3, levels, isDefault, isActive: true, createdAt: NOW, updatedAt: NOW });

beforeEach(async () => {
  await resetTables(appraisalAssignments, appraisalStagePositions, appraisalStages, appraisalCriterionPoints, appraisalCriteria, appraisalSections,
    appraisalTemplates, appraisalRatingScales, appraisalScoringForms, positions);
  await db.insert(positions).values([{ positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW }, { positionId: 'SUP', name: 'Supervisor', createdAt: NOW, updatedAt: NOW }]);
  await db.insert(appraisalRatingScales).values([scale('rs-default', 'Default', true), scale('rs-used', 'Used'), scale('rs-spare', 'Spare')]);
  await db.insert(appraisalScoringForms).values([
    { id: 'sf-used', name: 'Used form', sections: [], isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: 'sf-spare', name: 'Spare form', sections: [], isActive: true, createdAt: NOW, updatedAt: NOW },
  ]);
});
afterAll(async () => { await pool.end(); });

/** A form whose criteria were built from "Used" (a rating) and "Used form" (a scoring form, itself rated on "Used"). */
async function formUsing(makeLive: boolean) {
  const id = await createTemplate({
    name: 'Monthly', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
    sections: [{ name: 'Care', weight: 100, criteria: [
      { name: 'Love', description: null, weight: 50, inputType: 'RATING', scaleConfig: { scaleId: 'rs-used', max: 3, levels }, points: [] },
      { name: 'Care', description: null, weight: 50, inputType: 'FORM', points: [], scaleConfig: { scoringFormId: 'sf-used', name: 'Used form', sections: [
        { name: 'S', weight: 100, criteria: [{ name: 'C', weight: 100, inputType: 'RATING', scaleConfig: { scaleId: 'rs-used', max: 3 } }] },
      ] } },
    ] }],
    stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] }],
  });
  await setFamilyPositions(id, ['EI']);
  if (makeLive) expect(await activateTemplate(id)).toBe('ok');
}

describe('Appraisal settings — what a live form used is kept', () => {
  it('can\'t delete a rating scale or scoring form a live form used — only make it inactive', async () => {
    await formUsing(true);
    const scales = (await call(listAppraisalRatingScales)).body;
    expect(scales.map((s: any) => [s.name, s.inUse])).toEqual([['Default', false], ['Spare', false], ['Used', true]]);
    const blocked = await call(deleteAppraisalRatingScale, { id: 'rs-used' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.message).toMatch(/make it inactive instead/);
    expect((await call(setAppraisalRatingScaleActive, { id: 'rs-used' }, { active: false })).body.isActive).toBe(false);
    expect((await call(listAppraisalScoringForms)).body.map((f: any) => [f.name, f.inUse])).toEqual([['Spare form', false], ['Used form', true]]);
    expect((await call(deleteAppraisalScoringForm, { id: 'sf-used' })).statusCode).toBe(409);
    // Ones no live form used can still go.
    expect((await call(deleteAppraisalRatingScale, { id: 'rs-spare' })).statusCode).toBe(204);
    expect((await call(deleteAppraisalScoringForm, { id: 'sf-spare' })).statusCode).toBe(204);
  });

  it('doesn\'t count a draft that was never live', async () => {
    await formUsing(false);
    expect((await call(deleteAppraisalRatingScale, { id: 'rs-used' })).statusCode).toBe(204);
    expect((await call(deleteAppraisalScoringForm, { id: 'sf-used' })).statusCode).toBe(204);
  });
});
