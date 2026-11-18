import { describe, it, expect } from 'vitest';
import { careerLadder, entryTiers, nextOnLadder, reportingProblem, type DepartmentHeads } from '../../services/orgStructure.logic.js';

// Organisational structure: who each position may report to.
// Management: Principal (head, 6) ← Shadow Principal (5). Academic: Supervisor (head, 4) ← Senior EI (3), Junior EI (2).

const pos = (positionId: string, departmentId: string, titleWeight: number, reportsToPositionId: string | null = null) =>
  ({ positionId, departmentId, titleWeight, reportsToPositionId });
const all = [
  pos('EP', 'MGMT', 6), pos('SP', 'MGMT', 5, 'EP'),
  pos('SV', 'ACAD', 4, 'SP'), pos('SEI', 'ACAD', 3, 'SV'), pos('EI', 'ACAD', 2, 'SV'),
  pos('STAFF', 'SUPPORT', 1),
];
const heads: DepartmentHeads = new Map([['MGMT', 'EP'], ['ACAD', 'SV'], ['SUPPORT', null]]);
const self = (id: string) => all.find(p => p.positionId === id)!;

describe('Organisational structure — reporting lines', () => {
  it('lets a position report to a higher-ranked one in its own department, and a head to another department', () => {
    expect(reportingProblem(all, heads, self('EI'), 'SEI')).toBeNull();
    expect(reportingProblem(all, heads, self('SP'), 'EP')).toBeNull();
    // Academic's head reports into Management.
    expect(reportingProblem(all, heads, self('SV'), 'EP')).toBeNull();
    // The very top, and a department with no head yet, may report to nobody.
    expect(reportingProblem(all, heads, self('EP'), null)).toBeNull();
    expect(reportingProblem(all, heads, self('STAFF'), null)).toBeNull();
  });

  it('keeps everyone but the head inside the department, and only reporting upwards', () => {
    expect(reportingProblem(all, heads, self('SEI'), 'EP')).toBe('It reports within its own department — only the department’s head reports outside it.');
    expect(reportingProblem(all, heads, self('SEI'), 'EI')).toBe('It can only report to a higher-ranked position.');
    expect(reportingProblem(all, heads, self('EI'), null)).toBe('It isn’t its department’s head, so it reports to a position in its own department.');
    expect(reportingProblem(all, heads, self('SV'), 'SEI')).toBe('A department’s head reports to a position in another department.');
    // Once a department is marked as management, heads report only into it (not to another ordinary department).
    const management = new Set(['MGMT']);
    expect(reportingProblem(all, heads, self('SV'), 'STAFF', management)).toBe('A department’s head reports to a position in a management department.');
    expect(reportingProblem(all, heads, self('SV'), 'EP', management)).toBeNull();
  });

  it('refuses reporting to itself, to a position that no longer exists, or in a loop', () => {
    expect(reportingProblem(all, heads, self('SP'), 'SP')).toBe('A position can’t report to itself.');
    expect(reportingProblem(all, heads, self('SP'), 'GONE')).toBe('That position no longer exists — pick again.');
    // Management's head reporting to Academic's head, which reports up to Management: a loop.
    expect(reportingProblem(all, heads, self('EP'), 'SV')).toBe('That would make a loop — the position it reports to already reports to it.');
  });
});

describe('Organisational structure — career path', () => {
  // Academic: Assistant 1, Junior 2, Senior 3 → Supervisor 4 (head, reports to Shadow Principal); Management: Shadow 5 → Principal 6.
  const cp = (positionId: string, departmentId: string, titleWeight: number, reportsToPositionId: string | null, inCareerProgression = true) =>
    ({ positionId, departmentId, titleWeight, reportsToPositionId, inCareerProgression });
  const all = [
    cp('AEI', 'ACAD', 1, 'SV'), cp('EI', 'ACAD', 2, 'SV'), cp('SEI', 'ACAD', 3, 'SV'), cp('SV', 'ACAD', 4, 'SP'),
    cp('SP', 'MGMT', 5, 'EP'), cp('EP', 'MGMT', 6, null),
    cp('STAFF', 'SUP', 1, 'EP', false), cp('LEAD', 'SUP', 2, 'EP'), cp('CLERK', 'SUP', 1, 'LEAD'),
  ];
  const heads: DepartmentHeads = new Map([['ACAD', 'SV'], ['MGMT', 'EP'], ['SUP', 'LEAD']]);
  const ids = (ps: { positionId: string }[]) => ps.map(p => p.positionId);

  it('climbs the department by rank to its head, then follows the head’s reporting line up', () => {
    // Same manager (Supervisor) for every EI, yet each is its own step.
    expect(ids(careerLadder(all, heads, 'EI'))).toEqual(['AEI', 'EI', 'SEI', 'SV', 'SP', 'EP']);
    expect(nextOnLadder(careerLadder(all, heads, 'EI'), all[1])?.positionId).toBe('SEI');
    expect(nextOnLadder(careerLadder(all, heads, 'EP'), all[5])).toBeNull();
  });

  it('gives each department its own path, skipping positions off the career path', () => {
    // Support: Clerk → Lead (head) → Principal — never mixed into the teachers' steps; Staff isn't on a path.
    expect(ids(careerLadder(all, heads, 'CLERK'))).toEqual(['CLERK', 'LEAD', 'EP']);
    // Entry tiers per department (for the leaderboard): the first steps of each.
    expect([...entryTiers(all, 2)].sort()).toEqual(['AEI', 'CLERK', 'EI', 'EP', 'LEAD', 'SP']);
  });
});

import { personReportsToProblem } from '../../services/orgStructure.logic.js';

describe('Staff record — who someone can report to', () => {
  const positions = [
    { positionId: 'EI', departmentId: 'ACAD', titleWeight: 2 },
    { positionId: 'AS', departmentId: 'ACAD', titleWeight: 3 },
    { positionId: 'SV', departmentId: 'ACAD', titleWeight: 4 },
    { positionId: 'EP', departmentId: 'MGMT', titleWeight: 6 },
    { positionId: 'OM', departmentId: 'SUP', titleWeight: 9 },
  ];
  const mgmt = new Set(['MGMT']);
  it('allows someone higher in their own department or anyone in Management, and nobody only for Management', () => {
    expect(personReportsToProblem('EI', 'AS', true, positions, mgmt)).toBeNull();
    expect(personReportsToProblem('EI', 'SV', true, positions, mgmt)).toBeNull();
    expect(personReportsToProblem('EI', 'EP', true, positions, mgmt)).toBeNull();
    expect(personReportsToProblem('SV', 'EI', true, positions, mgmt)).toMatch(/higher-ranked/);
    expect(personReportsToProblem('EI', 'OM', true, positions, mgmt)).toMatch(/higher-ranked/);
    expect(personReportsToProblem('EI', null, false, positions, mgmt)).toMatch(/only Management staff/);
    expect(personReportsToProblem('EP', null, false, positions, mgmt)).toBeNull();
  });
});
