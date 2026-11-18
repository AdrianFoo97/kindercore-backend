import { describe, it, expect } from 'vitest';
import { checkTemplate, isNotApplicable, normaliseCriterion } from '../../services/appraisalScoring.service.js';
import { rawValueProblem } from '../../services/appraisalRun.logic.js';
import { pointsFromSop, refreshSopSections } from '../../services/sopRefresh.logic.js';
import { observationMarkingFrom, storedMarks } from '../../services/sopTraining.logic.js';

// SOP steps marked on levels (each worth a percentage) instead of pass / fail —
// on SOP scoring forms and on practice observations. N/A is always there and never counted.

const levels = { levels: [{ label: 'Fail', score: 0 }, { label: 'Satisfactory', score: 60 }, { label: 'Excellent', score: 100 }] };
const step = { name: 'Greet parents', inputType: 'LEVELS' as const, scaleConfig: levels };

describe('SOP steps marked on levels', () => {
  it('scores a level as its percentage, and leaves N/A out', () => {
    expect(normaliseCriterion(step, 1)).toBe(60);
    expect(normaliseCriterion(step, 2)).toBe(100);
    expect(normaliseCriterion(step, -1)).toBeNull();
    expect(isNotApplicable('LEVELS', -1)).toBe(true);
  });

  it('only accepts one of the step’s levels, or N/A', () => {
    expect(rawValueProblem(step, 0)).toBeNull();
    expect(rawValueProblem(step, -1)).toBeNull();
    expect(rawValueProblem(step, 3)).toMatch(/one of its levels/);
    expect(rawValueProblem(step, 1.5)).toMatch(/one of its levels/);
  });

  it('lets an SOP checked on levels go live, like one checked pass / fail', () => {
    const t = { missingPolicy: 'REQUIRE_ALL' as const, sections: [{ name: 'SOPs', weight: 100, criteria: [{ id: 'c', name: 'Gate Duty', weight: 100, inputType: 'POINTS' as const, scaleConfig: null, points: [{ id: 'p', ...step }] }] }] };
    expect(checkTemplate(t as never).filter(p => /several points/.test(p))).toEqual([]);
  });

  it('keeps the form’s levels when an edited SOP’s steps are brought up to date', () => {
    const sop = { id: 's', title: 'Gate Duty', steps: [{ section: 'Main', title: 'Open the gate', detail: null, displayOrder: 1 }, { section: 'Main', title: 'Wave', detail: null, displayOrder: 2 }] };
    const r = refreshSopSections([{ criteria: [{ name: 'Gate Duty', inputType: 'POINTS', sopTemplateId: 's', points: [{ name: 'Open the gate', description: null, inputType: 'LEVELS', scaleConfig: levels }] }] }], new Map([['s', sop]]));
    expect(r.sections[0].criteria[0].points).toEqual(pointsFromSop(sop, { inputType: 'LEVELS', scaleConfig: levels }));
    expect(r.sections[0].criteria[0].points!.every(p => (p as { inputType: string }).inputType === 'LEVELS')).toBe(true);
  });
});

describe('Practice observations marked on levels', () => {
  const marking = observationMarkingFrom({ inputType: 'LEVELS', ...levels, passMark: 60 });

  it('reads the setting, and treats anything incomplete as pass / fail', () => {
    expect(marking).toMatchObject({ inputType: 'LEVELS', passMark: 60 });
    expect(observationMarkingFrom(null)).toEqual({ inputType: 'PASS_FAIL' });
    expect(observationMarkingFrom({ inputType: 'LEVELS', levels: [{ label: 'Only one', score: 50 }] })).toEqual({ inputType: 'PASS_FAIL' });
    // No pass mark given: the lowest level worth something passes.
    expect(observationMarkingFrom({ inputType: 'LEVELS', ...levels })).toMatchObject({ passMark: 60 });
  });

  it('passes a step at or above the pass mark, fails it below, and keeps N/A out', () => {
    const r = storedMarks(marking, [{ stepId: 'a', level: 2 }, { stepId: 'b', level: 0, note: 'Gate left open' }, { stepId: 'c', level: -1 }]);
    expect(r).toEqual({ marks: [
      { stepId: 'a', passed: 'PASS', level: 2, note: null },
      { stepId: 'b', passed: 'FAIL', level: 0, note: 'Gate left open' },
      { stepId: 'c', passed: 'NA', level: null, note: null },
    ] });
    expect(storedMarks(marking, [{ stepId: 'a', level: 7 }])).toEqual({ problem: expect.stringMatching(/isn’t one of this observation’s levels/) });
  });
});
