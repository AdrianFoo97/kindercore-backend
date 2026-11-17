import { describe, it, expect } from 'vitest';
import {
  criterionScores, formItemKey, formKey, isDue, monthScoreOf, periodOf, rawValueProblem, scoreRun, scorerMaySignOff, stepAfter, type ScorableTemplate,
} from '../../services/appraisalRun.logic.js';

// Scoring an appraisal with a form: when one is due, what may be entered, how
// each criterion and the total are worked out, and where it goes next.

const template: ScorableTemplate = {
  missingPolicy: 'REQUIRE_ALL',
  sections: [
    { id: 's1', name: 'Core values', weight: 50, criteria: [
      { id: 'love', name: 'Love for children', weight: 50, inputType: 'RATING', scaleConfig: { max: 5 } },
      // Scored from a copy of a scoring form: Care 100% → Patience (rating 1–4) 50% + Calm (yes/no) 50%.
      { id: 'care', name: 'Classroom care', weight: 50, inputType: 'FORM', scaleConfig: { scoringFormId: 'sf', name: 'Care', sections: [
        { name: 'Care', weight: 100, criteria: [
          { name: 'Patience', weight: 50, inputType: 'RATING', scaleConfig: { max: 4 } },
          { name: 'Calm', weight: 50, inputType: 'YES_NO', scaleConfig: null },
        ] },
      ] } },
    ] },
    { id: 's2', name: 'KPI', weight: 50, criteria: [
      { id: 'late', name: 'Days late', weight: 100, inputType: 'NUMBER', scaleConfig: { target: 2, higherIsBetter: false } },
    ] },
  ],
};

describe('Appraisal workflow — periods', () => {
  it('puts a month in its period, and says when one is due', () => {
    expect(periodOf('QUARTERLY', 2026, 4)).toEqual({ year: 2026, month: 3 });
    expect(periodOf('YEARLY', 2026, 8)).toEqual({ year: 2026, month: 0 });
    expect(periodOf('MONTHLY', 2026, 8)).toEqual({ year: 2026, month: 8 });
    expect([0, 1, 3].map(m => isDue('QUARTERLY', m))).toEqual([true, false, true]);
    // "When needed" forms are never due — they're started by hand.
    expect(isDue('MANUAL', 0)).toBe(false);
  });
});

describe('Appraisal workflow — scoring', () => {
  it('only accepts values that fit the kind of criterion', () => {
    expect(rawValueProblem({ name: 'Love', inputType: 'RATING', scaleConfig: { max: 5 } }, 6)).toBe('"Love" is rated 1 to 5.');
    expect(rawValueProblem({ name: 'Love', inputType: 'RATING', scaleConfig: { max: 5 } }, 4)).toBeNull();
    expect(rawValueProblem({ name: 'Calm', inputType: 'YES_NO' }, 0.5)).toBe('"Calm" is yes or no.');
    expect(rawValueProblem({ name: 'Plans', inputType: 'PERCENT' }, 101)).toBe('"Plans" is a percentage, 0 to 100.');
  });

  it('scores a criterion from a copied scoring form as that form\'s weighted total', () => {
    const scores = criterionScores(template, [
      { criterionId: 'care', pointId: formKey(0, 0), rawValue: 2 }, // 2 of 4 = 50
      { criterionId: 'care', pointId: formKey(0, 1), rawValue: 1 }, // yes = 100
    ]);
    expect(scores.care).toBe(75);
  });

  it('works out the weighted total once everything is scored, and waits until then', () => {
    const entered = [
      { criterionId: 'love', pointId: null, rawValue: 4 }, // 80
      { criterionId: 'care', pointId: formKey(0, 0), rawValue: 2 },
      { criterionId: 'care', pointId: formKey(0, 1), rawValue: 1 }, // 75
    ];
    expect(scoreRun(template, entered)).toMatchObject({ total: null, complete: false, missing: ['late'] });
    const done = scoreRun(template, [...entered, { criterionId: 'late', pointId: null, rawValue: 1 }]); // 100
    // Core values (80+75)/2 = 77.5; KPI 100 → (77.5 + 100) / 2 = 88.8 (one decimal).
    expect(done).toMatchObject({ total: 88.8, complete: true });
  });

  it('checks SOP steps pass, fail or N/A, leaving N/A out so the other steps share its weight', () => {
    expect(rawValueProblem({ name: 'Wash hands', inputType: 'PASS_FAIL' }, -1)).toBeNull();
    expect(rawValueProblem({ name: 'Wash hands', inputType: 'PASS_FAIL' }, 2)).toBe('"Wash hands" is pass, fail or N/A.');
    // An SOP scoring form: Arrival (3 steps) 50% + Hygiene (1 step) 50%, scored on its own.
    const sop: ScorableTemplate = {
      missingPolicy: 'REQUIRE_ALL',
      sections: [{ id: 's', name: 'SOP', weight: 100, criteria: [
        { id: 'sop', name: 'Morning arrival SOP', weight: 100, inputType: 'FORM', scaleConfig: { scoringFormId: 'sf', name: 'Arrival', sections: [
          { name: 'Arrival', weight: 50, criteria: [
            { name: 'Greet', weight: 34, inputType: 'PASS_FAIL', scaleConfig: null },
            { name: 'Temperature', weight: 33, inputType: 'PASS_FAIL', scaleConfig: null },
            { name: 'Bag check', weight: 33, inputType: 'PASS_FAIL', scaleConfig: null },
          ] },
          { name: 'Hygiene', weight: 50, criteria: [{ name: 'Wash hands', weight: 100, inputType: 'PASS_FAIL', scaleConfig: null }] },
        ] } },
      ] }],
    };
    const pass = 1, fail = 0, na = -1;
    // Arrival: pass, fail, N/A → (34·100 + 33·0) / 67 = 50.7; Hygiene pass 100 → total 75.4. Nothing missing — N/A isn't a gap.
    const some = scoreRun(sop, [
      { criterionId: 'sop', pointId: formKey(0, 0), rawValue: pass },
      { criterionId: 'sop', pointId: formKey(0, 1), rawValue: fail },
      { criterionId: 'sop', pointId: formKey(0, 2), rawValue: na },
      { criterionId: 'sop', pointId: formKey(1, 0), rawValue: pass },
    ]);
    expect(some).toMatchObject({ total: 75.4, complete: true, missing: [] });
    // A whole section N/A drops out: only Arrival counts.
    const noHygiene = scoreRun(sop, [
      { criterionId: 'sop', pointId: formKey(0, 0), rawValue: pass },
      { criterionId: 'sop', pointId: formKey(0, 1), rawValue: pass },
      { criterionId: 'sop', pointId: formKey(0, 2), rawValue: fail },
      { criterionId: 'sop', pointId: formKey(1, 0), rawValue: na },
    ]);
    expect(noHygiene.total).toBe(67);
  });

  it('scores SOPs grouped in sections: each SOP passed ÷ decided from its steps, then by its share of the section', () => {
    // Section "Routines" 60% (Gate 50%, Lunch 50%) + "Safety" 40% (Incidents 100%).
    const sop = (name: string, weight: number, steps: number) =>
      ({ name, weight, inputType: 'POINTS', scaleConfig: null, points: Array.from({ length: steps }, (_, i) => ({ name: `${name} ${i + 1}`, inputType: 'PASS_FAIL', scaleConfig: null })) });
    const t: ScorableTemplate = {
      missingPolicy: 'REQUIRE_ALL',
      sections: [{ id: 's', name: 'SOP', weight: 100, criteria: [
        { id: 'sops', name: 'SOP compliance', weight: 100, inputType: 'FORM', scaleConfig: { scoringFormId: 'sf', name: 'SOP Audit', sections: [
          { name: 'Routines', weight: 60, criteria: [sop('Gate', 50, 3), sop('Lunch', 50, 2)] },
          { name: 'Safety', weight: 40, criteria: [sop('Incidents', 100, 1)] },
        ] } },
      ] }],
    };
    const k = formItemKey;
    const entered = [
      // Gate: pass, fail, N/A → 1 of 2 decided = 50. Lunch: pass, pass = 100. Routines = 75.
      { criterionId: 'sops', pointId: k(0, 0, 0), rawValue: 1 }, { criterionId: 'sops', pointId: k(0, 0, 1), rawValue: 0 }, { criterionId: 'sops', pointId: k(0, 0, 2), rawValue: -1 },
      { criterionId: 'sops', pointId: k(0, 1, 0), rawValue: 1 }, { criterionId: 'sops', pointId: k(0, 1, 1), rawValue: 1 },
      // Incidents: fail = 0. Total = 75·0.6 + 0·0.4 = 45.
      { criterionId: 'sops', pointId: k(1, 0, 0), rawValue: 0 },
    ];
    expect(scoreRun(t, entered)).toMatchObject({ total: 45, complete: true, missing: [] });
    // A whole SOP marked N/A drops out of its section: Lunch alone → Routines 100 → 100·0.6 + 0·0.4 over 100 = 60.
    const gateNA = entered.map(e => (e.pointId.startsWith('f:0:0:') ? { ...e, rawValue: -1 } : e));
    expect(scoreRun(t, gateNA).total).toBe(60);
  });
});

describe('Appraisal workflow — steps', () => {
  it('goes from scoring to each sign-off, then to the staff member, then done', () => {
    const steps = [{ kind: 'ASSESS' as const, sortOrder: 0 }, { kind: 'SIGN_OFF' as const, sortOrder: 1 }, { kind: 'ACKNOWLEDGE' as const, sortOrder: 2 }];
    expect(stepAfter(steps, 0)).toEqual({ status: 'AWAITING_SIGN_OFF', order: 1 });
    expect(stepAfter(steps, 1)).toEqual({ status: 'AWAITING_ACKNOWLEDGEMENT', order: 2 });
    expect(stepAfter(steps, 2)).toEqual({ status: 'COMPLETED', order: null });
    // No sign-off and no acknowledging: done once scored.
    expect(stepAfter([{ kind: 'ASSESS', sortOrder: 0 }], 0)).toEqual({ status: 'COMPLETED', order: null });
  });
});

describe('Signing off, and a month with two appraisals', () => {
  it('lets whoever scored it sign it off only from the top of the reporting line', () => {
    expect(scorerMaySignOff(false, false)).toBe(true); // someone else scored it
    expect(scorerMaySignOff(true, true)).toBe(true);   // scored it, no one above them
    expect(scorerMaySignOff(true, false)).toBe(false); // scored it, someone above signs off
  });

  it('makes a month with two completed appraisals score their average', () => {
    expect(monthScoreOf([80], 80)).toBe(80);
    expect(monthScoreOf([70.2, 85], 85)).toBe(77.6);
    expect(monthScoreOf([], 64)).toBe(64);
  });
});
