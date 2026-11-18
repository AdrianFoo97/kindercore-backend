import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalLogs, appraisalScores, appraisalScoringForms, appraisalSections,
  appraisalStagePositions, appraisalStages, appraisalTemplates, appraisals, positions, sopSteps, sopTemplates, teacherAppraisals, teachers,
} from '../../db/schema.js';
import { SCHEDULER, createRun, saveScores, actorFor } from '../../services/appraisalRuns.service.js';
import { activateTemplate, createTemplate, loadTemplate, setFamilyPositions } from '../../services/appraisalTemplates.service.js';
import { resetTables } from './testDb.js';

// An appraisal form that scores an SOP (through an SOP scoring form): appraisals
// already created keep the SOP steps they were made with; one created after the
// SOP is edited uses its current steps. Real services, test DB.

const NOW = new Date('2026-11-01T00:00:00Z');
const staff = (id: string, name: string) => ({ id, name, color: '#7c3aed', positionId: 'EI', createdAt: NOW, updatedAt: NOW });
const step = (id: string, title: string, displayOrder: number) => ({ id, sopTemplateId: 'sop-gate', section: 'Main', title, displayOrder, createdAt: NOW, updatedAt: NOW });
const sopCriterion = (titles: string[]) => ({
  name: 'Gate Duty', description: null, weight: 100, inputType: 'POINTS', scaleConfig: null, sopTemplateId: 'sop-gate',
  points: titles.map(name => ({ name, description: null, inputType: 'PASS_FAIL', scaleConfig: null })),
});
const sections = (titles: string[]) => [{ name: 'SOPs', weight: 100, criteria: [sopCriterion(titles)] }];

let familyId = '';

beforeEach(async () => {
  await resetTables(appraisalLogs, appraisalScores, appraisals, appraisalAssignments, appraisalStagePositions, appraisalStages, appraisalCriterionPoints,
    appraisalCriteria, appraisalSections, appraisalTemplates, appraisalScoringForms, teacherAppraisals, sopSteps, sopTemplates, teachers, positions);
  await db.insert(positions).values([{ positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW }, { positionId: 'SUP', name: 'Supervisor', createdAt: NOW, updatedAt: NOW }]);
  await db.insert(teachers).values([staff('t-tina', 'Tina'), staff('t-nur', 'Nur')]);
  await db.insert(sopTemplates).values({ id: 'sop-gate', title: 'Gate Duty', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopSteps).values([step('st-1', 'Open the gate', 1), step('st-2', 'Greet parents', 2)]);
  await db.insert(appraisalScoringForms).values({ id: 'sf-gate', name: 'SOP Audit', sections: sections(['Open the gate', 'Greet parents']), sopTemplateIds: ['sop-gate'], createdAt: NOW, updatedAt: NOW });
  familyId = await createTemplate({
    name: 'Monthly EI appraisal', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
    sections: [{ name: 'Duties', weight: 100, criteria: [{ name: 'SOP Audit', description: null, weight: 100, inputType: 'FORM', points: [],
      scaleConfig: { scoringFormId: 'sf-gate', name: 'SOP Audit', sections: sections(['Open the gate', 'Greet parents']) } }] }],
    stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'ANYONE', positionIds: ['SUP'] }],
  } as never);
  await setFamilyPositions(familyId, ['EI']);
  await activateTemplate(familyId);
});
afterAll(async () => { await pool.end(); });

/** The SOP steps an appraisal is scored on (from the form version it was created with). */
const stepsOf = async (runId: string) => {
  const [run] = await db.select().from(appraisals).where(eq(appraisals.id, runId));
  const t = await loadTemplate(run.templateId);
  const copy = t!.sections[0].criteria[0].scaleConfig as { sections: { criteria: { points: { name: string }[] }[] }[] };
  return { version: t!.version, steps: copy.sections[0].criteria[0].points.map(p => p.name) };
};

describe('Appraisals scored on SOPs — new ones use the SOP as it is now', () => {
  it('keeps an appraisal already created on its SOP steps, and creates the next one with the edited steps', async () => {
    const first = (await createRun('t-tina', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string }).id;
    expect(await stepsOf(first)).toEqual({ version: 1, steps: ['Open the gate', 'Greet parents'] });

    // Someone edits the SOP: a step renamed, one added.
    await db.update(sopSteps).set({ title: 'Unlock and open the gate' }).where(eq(sopSteps.id, 'st-1'));
    await db.insert(sopSteps).values(step('st-3', 'Close the gate at 8:30', 3));

    const second = (await createRun('t-nur', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string }).id;
    expect(await stepsOf(second)).toEqual({ version: 2, steps: ['Unlock and open the gate', 'Greet parents', 'Close the gate at 8:30'] });
    // The first appraisal didn't change.
    expect(await stepsOf(first)).toEqual({ version: 1, steps: ['Open the gate', 'Greet parents'] });
    // The scoring form in Settings shows the SOP as it is now too.
    const [sf] = await db.select().from(appraisalScoringForms).where(eq(appraisalScoringForms.id, 'sf-gate'));
    expect((sf.sections as { criteria: { points: unknown[] }[] }[])[0].criteria[0].points).toHaveLength(3);
  });

  it('uses the SOP scoring form as it is now — e.g. its steps switched to levels — for appraisals created after', async () => {
    const first = (await createRun('t-tina', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string }).id;
    const levels = { levels: [{ label: 'Fail', score: 0 }, { label: 'Good', score: 100 }], source: { kind: 'CUSTOM' } };
    const leveled = sections(['Open the gate', 'Greet parents']).map(s => ({ ...s, criteria: s.criteria.map(c => ({ ...c, points: c.points.map(p => ({ ...p, inputType: 'LEVELS', scaleConfig: levels })) })) }));
    await db.update(appraisalScoringForms).set({ sections: leveled }).where(eq(appraisalScoringForms.id, 'sf-gate'));
    const second = (await createRun('t-nur', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string }).id;
    const marking = async (runId: string) => {
      const [run] = await db.select().from(appraisals).where(eq(appraisals.id, runId));
      const copy = (await loadTemplate(run.templateId))!.sections[0].criteria[0].scaleConfig as { sections: { criteria: { points: { inputType: string }[] }[] }[] };
      return copy.sections[0].criteria[0].points.map(p => p.inputType);
    };
    expect(await marking(second)).toEqual(['LEVELS', 'LEVELS']);
    expect(await marking(first)).toEqual(['PASS_FAIL', 'PASS_FAIL']); // already created: unchanged
  });

  it('doesn’t make a new version when no SOP has changed', async () => {
    await createRun('t-tina', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER);
    const later = (await createRun('t-nur', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string }).id;
    expect((await stepsOf(later)).version).toBe(1);
    expect(await db.select().from(appraisalTemplates)).toHaveLength(1);
  });
});

describe('Appraisals scored on SOP steps marked on levels', () => {
  it('scores each step as its level’s percentage and leaves N/A out', async () => {
    // The form's SOP steps marked Fail 0 / Satisfactory 60 / Excellent 100.
    const levels = { levels: [{ label: 'Fail', score: 0 }, { label: 'Satisfactory', score: 60 }, { label: 'Excellent', score: 100 }] };
    const leveled = sections(['Open the gate', 'Greet parents', 'Close the gate']).map(s => ({ ...s, criteria: s.criteria.map(c => ({ ...c, sopTemplateId: undefined, points: c.points.map(p => ({ ...p, inputType: 'LEVELS', scaleConfig: levels })) })) })); // not linked to an SOP: this is about scoring, not keeping steps current
    const id = await createTemplate({
      name: 'Levels form', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
      sections: [{ name: 'Duties', weight: 100, criteria: [{ name: 'SOP Audit', description: null, weight: 100, inputType: 'FORM', points: [],
        scaleConfig: { scoringFormId: 'sf-none', name: 'SOP Audit', sections: leveled } }] }],
      stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'ANYONE', positionIds: ['SUP'] }],
    } as never);
    await setFamilyPositions(id, ['SUP']);
    expect(await activateTemplate(id)).toBe('ok');
    const run = (await createRun('t-tina', id, 'MONTHLY', { year: 2026, month: 9 }, SCHEDULER) as { id: string }).id;
    const crit = (await loadTemplate(id))!.sections[0].criteria[0]; // this form's own SOP Audit
    const admin = await actorFor({ id: 'u-admin', role: 'ADMIN', teacherId: null }, true);
    const saved = await saveScores(run, admin, [
      { criterionId: crit.id, pointId: 'f:0:0:0', rawValue: 1 }, // Satisfactory = 60
      { criterionId: crit.id, pointId: 'f:0:0:1', rawValue: 2 }, // Excellent = 100
      { criterionId: crit.id, pointId: 'f:0:0:2', rawValue: -1 }, // N/A — not counted
    ], null) as { workingTotal: number };
    expect(saved.workingTotal).toBe(80);
    expect(await saveScores(run, admin, [{ criterionId: crit.id, pointId: 'f:0:0:0', rawValue: 5 }], null)).toMatchObject({ status: 400 });
  });
});
