import { describe, it, expect } from 'vitest';
import { pointsFromSop, refreshSopSections, type SopNow } from '../../services/sopRefresh.logic.js';

// Appraisals scored on SOPs: new ones use each SOP as it is now.

const step = (title: string, displayOrder: number, section = 'Main', detail: string | null = null) => ({ section, title, detail, displayOrder });
const gate: SopNow = { id: 'sop-gate', title: 'Gate Duty', steps: [step('Open the gate', 1), step('Greet parents', 2, 'Main', 'Smile and say hello')] };
const sops = new Map([[gate.id, gate]]);
const crit = (over: Record<string, unknown> = {}) => ({
  name: 'Gate Duty', description: null, weight: 100, inputType: 'POINTS', scaleConfig: null,
  points: [{ name: 'Open the gate', description: null, inputType: 'PASS_FAIL', scaleConfig: null }], ...over,
});

describe('Keeping SOP steps current for new appraisals', () => {
  it('turns an SOP’s steps into pass / fail / N/A points, in order, naming the section when there are several', () => {
    expect(pointsFromSop(gate).map(p => [p.name, p.description])).toEqual([['Open the gate', null], ['Greet parents', 'Smile and say hello']]);
    const two: SopNow = { id: 's', title: 'Bags', steps: [step('Zip it', 2, 'Close'), step('Hang it', 1, 'Store')] };
    expect(pointsFromSop(two).map(p => p.name)).toEqual(['Store · Hang it', 'Close · Zip it']);
  });

  it('brings an SOP criterion up to date — by the SOP it remembers, or by name on an older form', () => {
    const byId = refreshSopSections([{ name: 'SOPs', criteria: [crit({ sopTemplateId: 'sop-gate' })] }], sops);
    expect(byId.changed).toBe(true);
    expect(byId.sections[0].criteria[0].points!.map(p => p.name)).toEqual(['Open the gate', 'Greet parents']);
    const byName = refreshSopSections([{ name: 'SOPs', criteria: [crit()] }], sops, ['sop-gate']);
    expect(byName.changed).toBe(true);
    expect((byName.sections[0].criteria[0] as { sopTemplateId?: string }).sopTemplateId).toBe('sop-gate'); // remembers it from now on
  });

  it('changes nothing when the SOP hasn’t changed, has no steps, or is gone', () => {
    const current = crit({ sopTemplateId: 'sop-gate', points: pointsFromSop(gate) });
    expect(refreshSopSections([{ name: 'SOPs', criteria: [current] }], sops).changed).toBe(false);
    const empty = new Map([['sop-gate', { ...gate, steps: [] }]]);
    expect(refreshSopSections([{ name: 'SOPs', criteria: [crit({ sopTemplateId: 'sop-gate' })] }], empty).changed).toBe(false);
    expect(refreshSopSections([{ name: 'SOPs', criteria: [crit({ sopTemplateId: 'sop-gone' })] }], sops).changed).toBe(false);
  });

  it('follows a renamed SOP it remembers', () => {
    const renamed = new Map([['sop-gate', { ...gate, title: 'Front Gate Duty' }]]);
    const r = refreshSopSections([{ name: 'SOPs', criteria: [crit({ sopTemplateId: 'sop-gate', points: pointsFromSop(gate) })] }], renamed);
    expect(r.changed).toBe(true);
    expect(r.sections[0].criteria[0].name).toBe('Front Gate Duty');
  });
});
