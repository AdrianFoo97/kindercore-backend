import { describe, it, expect } from 'vitest';
import {
  canActOnStage, checkStages, checkTemplate, combinePoints, managerChainOf, teamOf, normaliseCriterion, scoreAppraisal, type TemplateDef,
} from '../../services/appraisalScoring.service.js';

// The customizable appraisal engine: template checks, 0–100 normalising,
// weighted totals, and who may act on each stage.

// The example: 50% core values (love 40, team spirit 30, ownership 30) + 50% KPI (SOP 50, incidents 30, punctuality 20).
const template = (policy: TemplateDef['missingPolicy'] = 'REQUIRE_ALL'): TemplateDef => ({
  missingPolicy: policy,
  sections: [
    { id: 'core', name: 'Core values', weight: 50, criteria: [
      { id: 'love', name: 'Love for children', weight: 40, inputType: 'RATING', scaleConfig: { max: 5 } },
      { id: 'team', name: 'Team spirit', weight: 30, inputType: 'RATING', scaleConfig: { max: 5 } },
      { id: 'own', name: 'Ownership', weight: 30, inputType: 'RATING', scaleConfig: { max: 5 } },
    ] },
    { id: 'kpi', name: 'KPI', weight: 50, criteria: [
      { id: 'sop', name: 'SOP compliance', weight: 50, inputType: 'AUTO', scaleConfig: {} },
      { id: 'inc', name: 'Preventable incidents', weight: 30, inputType: 'AUTO', scaleConfig: { bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 80 }, { upTo: 2, score: 60 }, { upTo: 999, score: 40 }] } },
      { id: 'punct', name: 'Punctuality', weight: 20, inputType: 'PERCENT' },
    ] },
  ],
});

describe('Appraisal engine — templates and scores', () => {
  it('accepts a template whose weights make 100% at every level, and explains what is wrong otherwise', () => {
    expect(checkTemplate(template())).toEqual([]);
    const bad = template();
    bad.sections[0].weight = 60;
    bad.sections[1].criteria[2].weight = 10;
    expect(checkTemplate(bad)).toEqual([
      'Section weights add up to 110% — they need to make 100%.',
      'Criteria in "KPI" add up to 90% — they need to make 100%.',
    ]);
  });

  it('turns every kind of input into 0–100', () => {
    expect(normaliseCriterion({ inputType: 'RATING', scaleConfig: { max: 5 } }, 4)).toBe(80);
    expect(normaliseCriterion({ inputType: 'PERCENT' }, 112)).toBe(100);
    expect(normaliseCriterion({ inputType: 'YES_NO' }, 0)).toBe(0);
    expect(normaliseCriterion({ inputType: 'NUMBER', scaleConfig: { target: 20, higherIsBetter: true } }, 15)).toBe(75);
    expect(normaliseCriterion({ inputType: 'NUMBER', scaleConfig: { target: 2, higherIsBetter: false } }, 3)).toBe(50);
    expect(normaliseCriterion({ inputType: 'NUMBER', scaleConfig: { target: 2, higherIsBetter: false } }, 1)).toBe(100);
    expect(normaliseCriterion({ inputType: 'RATING', scaleConfig: { max: 5 } }, null)).toBeNull();
  });

  it('scores automatic values through their bands — 0 preventable incidents is full marks', () => {
    const inc = template().sections[1].criteria[1];
    expect([0, 1, 2, 5].map(v => normaliseCriterion(inc, v))).toEqual([100, 80, 60, 40]);
  });

  it('works out the weighted total and each section, rounding once at the end', () => {
    // Core: love 4/5=80, team 5/5=100, own 3/5=60 → 80×.4 + 100×.3 + 60×.3 = 80
    // KPI: sop 90, inc 1 → 80, punct 70 → 45 + 24 + 14 = 83
    const r = scoreAppraisal(template(), { love: 80, team: 100, own: 60, sop: 90, inc: 80, punct: 70 });
    expect(r.bySection).toEqual([{ sectionId: 'core', score: 80 }, { sectionId: 'kpi', score: 83 }]);
    expect(r.total).toBe(81.5);
    expect(r.complete).toBe(true);
  });

  it('gives no total while anything is missing, unless the template spreads missing weight over the rest', () => {
    const scores = { love: 80, team: 100, own: 60, sop: 90, inc: 80, punct: null };
    const strict = scoreAppraisal(template('REQUIRE_ALL'), scores);
    expect(strict).toMatchObject({ total: null, complete: false, missing: ['punct'] });
    // KPI without punctuality: (90×50 + 80×30) / 80 = 86.25 → total (80 + 86.25) / 2 = 83.1
    const spread = scoreAppraisal(template('REWEIGHT'), scores);
    expect(spread.total).toBe(83.1);
    expect(spread.complete).toBe(true);
  });
});

describe('Appraisal engine — who may act on each stage', () => {
  const assess = { kind: 'ASSESS' as const, scope: 'OWN_TEAM' as const, positionIds: ['SUP', 'ASUP'] };
  const signOff = { kind: 'SIGN_OFF' as const, scope: 'ANYONE' as const, positionIds: ['PRIN'] };
  const ack = { kind: 'ACKNOWLEDGE' as const, scope: 'ANYONE' as const, positionIds: [] };
  // Tina → reports to Sam (assistant supervisor) → reports to Pat (principal).
  const reportsTo = new Map<string, string | null>([['tina', 'sam'], ['sam', 'pat'], ['pat', null], ['other', 'olga']]);
  const tinasManagers = managerChainOf('tina', reportsTo);
  const who = (teacherId: string, positionId: string | null, isAdmin = false) => ({ teacherId, positionId, isAdmin });

  it('finds someone\'s whole team — everyone who reports to them, directly or further down', () => {
    const reportsTo = new Map<string, string | null>([['sam', null], ['tina', 'sam'], ['ben', 'tina'], ['oli', null], ['zed', 'oli'], ['loop', 'loop']]);
    expect([...teamOf('sam', reportsTo)].sort()).toEqual(['ben', 'tina']);
    expect([...teamOf('ben', reportsTo)]).toEqual([]);
    expect([...teamOf('oli', reportsTo)]).toEqual(['zed']);
  });

  it('follows the reports-to chain upwards, and stops if it loops', () => {
    expect(tinasManagers).toEqual(['sam', 'pat']);
    expect(managerChainOf('a', new Map([['a', 'b'], ['b', 'a']]))).toEqual(['b']);
  });

  it('lets any position on an "own team" stage assess only the people who report to them — including a new position like Assistant Supervisor', () => {
    expect(canActOnStage(assess, who('sam', 'ASUP'), 'tina', tinasManagers)).toBe(true);
    expect(canActOnStage(assess, who('olga', 'SUP'), 'tina', tinasManagers)).toBe(false); // a supervisor, but not Tina's
    expect(canActOnStage(assess, who('pat', 'PRIN'), 'tina', tinasManagers)).toBe(false); // in the chain, wrong position
  });

  it('lets anyone in a sign-off position sign off, admins act on any stage, and nobody act on their own', () => {
    expect(canActOnStage(signOff, who('pat', 'PRIN'), 'tina', tinasManagers)).toBe(true);
    expect(canActOnStage(signOff, who('sam', 'ASUP'), 'tina', tinasManagers)).toBe(false);
    expect(canActOnStage(assess, who('boss', null, true), 'tina', tinasManagers)).toBe(true);
    expect(canActOnStage(signOff, who('tina', 'PRIN'), 'tina', tinasManagers)).toBe(false);
  });

  it('leaves acknowledging to the staff member alone', () => {
    expect(canActOnStage(ack, who('tina', 'T'), 'tina', tinasManagers)).toBe(true);
    expect(canActOnStage(ack, who('boss', null, true), 'tina', tinasManagers)).toBe(false);
  });
});

describe('Appraisal engine — the approval chain', () => {
  const step = (kind: 'ASSESS' | 'SIGN_OFF' | 'ACKNOWLEDGE', positionIds: string[] = ['SUP'], name: string = kind) =>
    ({ name, kind, scope: 'ANYONE' as const, positionIds });

  it('accepts assess, then any sign-offs, then acknowledge — and acknowledging needs no position', () => {
    expect(checkStages([step('ASSESS'), step('SIGN_OFF', ['PRIN']), step('ACKNOWLEDGE', [])])).toEqual([]);
    expect(checkStages([step('ASSESS')])).toEqual([]);
    expect(checkStages([step('ASSESS'), step('SIGN_OFF'), step('SIGN_OFF', ['PRIN'])])).toEqual([]);
  });

  it('refuses a chain that does not start with exactly one assess step, or puts acknowledging anywhere but last', () => {
    expect(checkStages([step('SIGN_OFF')])).toContain('Start with exactly one "Assessed by" step.');
    expect(checkStages([step('ASSESS'), step('ASSESS')])).toContain('Start with exactly one "Assessed by" step.');
    expect(checkStages([step('ASSESS'), step('ACKNOWLEDGE', []), step('SIGN_OFF')])).toContain('Acknowledging has to be the last step.');
  });

  it('needs at least one position on every assess and sign-off step', () => {
    expect(checkStages([step('ASSESS', [], 'Assessed by'), step('SIGN_OFF', [], 'Principal sign-off')])).toEqual([
      '"Assessed by" needs at least one position to do it.',
      '"Principal sign-off" needs at least one position to do it.',
    ]);
  });
});

describe('Appraisal engine — who scores', () => {
  it('lets only one position score an appraisal, so marks never clash', () => {
    const chain = (assessIds: string[]) => [
      { name: 'Assessed by', kind: 'ASSESS' as const, scope: 'OWN_TEAM' as const, positionIds: assessIds },
      { name: 'Signed off by', kind: 'SIGN_OFF' as const, scope: 'ANYONE' as const, positionIds: ['P-P', 'P-D'] },
    ];
    expect(checkStages(chain(['P-S', 'P-T']))).toEqual(['Only one position can score it — pick one.']);
    expect(checkStages(chain(['P-S']))).toEqual([]);
  });
});

describe('Appraisal engine — criteria judged on several points', () => {
  it('scores a criterion with points as the plain average of its points', () => {
    // Love and patience on 1–5: speaks calmly 4 (80), comforts children 5 (100), waits patiently 3 (60) → 80.
    expect(combinePoints([80, 100, 60], 'REQUIRE_ALL')).toBe(80);
    expect(combinePoints([100], 'REQUIRE_ALL')).toBe(100);
  });

  it('turns each point into 0–100 its own way before averaging', () => {
    // Cares (rating 4/5 = 80) + doesn't scold (yes = 100) → 90.
    const cares = normaliseCriterion({ inputType: 'RATING', scaleConfig: { max: 5 } }, 4);
    const noScold = normaliseCriterion({ inputType: 'YES_NO' }, 1);
    expect(combinePoints([cares, noScold], 'REQUIRE_ALL')).toBe(90);
  });

  it('asks for a target on a number point, not on the criterion above it', () => {
    const t: TemplateDef = { missingPolicy: 'REQUIRE_ALL', sections: [{ id: 's', name: 'Care', weight: 100, criteria: [{
      id: 'c', name: 'Love', weight: 100, inputType: 'RATING', scaleConfig: { max: 5 },
      points: [{ name: 'Cares', inputType: 'RATING', scaleConfig: { max: 5 } }, { name: 'Raised voice', inputType: 'NUMBER', scaleConfig: null }],
    }] }] };
    expect(checkTemplate(t)).toEqual(['"Raised voice" needs a target above 0.']);
  });

  it('never lets an old "on several points" criterion go live — it must be changed first — except an SOP checked step by step', () => {
    const t: TemplateDef = { missingPolicy: 'REQUIRE_ALL', sections: [{ id: 's', name: 'Care', weight: 100, criteria: [
      { id: 'c', name: 'Love', weight: 100, inputType: 'POINTS', points: [] },
    ] }] };
    const retired = '"Love" is scored on several points, which is no longer offered — pick how it\'s scored.';
    expect(checkTemplate(t)).toEqual([retired]);
    t.sections[0].criteria[0].points = [{ name: 'Cares', inputType: 'YES_NO' }];
    expect(checkTemplate(t)).toEqual([retired]);
    // …except an SOP checked step by step: every item pass / fail / N/A.
    t.sections[0].criteria[0].points = [{ name: 'Greet', inputType: 'PASS_FAIL' }, { name: 'Check in', inputType: 'PASS_FAIL' }];
    expect(checkTemplate(t)).toEqual([]);
    // Its score only ever comes from its points.
    expect(normaliseCriterion({ inputType: 'POINTS' }, 80)).toBeNull();
  });

  it('waits for every point unless the form lets unscored ones drop out', () => {
    expect(combinePoints([80, null, 60], 'REQUIRE_ALL')).toBeNull();
    expect(combinePoints([80, null, 60], 'REWEIGHT')).toBe(70);
    expect(combinePoints([null, undefined], 'REWEIGHT')).toBeNull();
  });
});
