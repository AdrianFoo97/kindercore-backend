import { describe, it, expect } from 'vitest';
import { resolveOpenings } from '../../services/recruitmentOpenings.logic.js';

// Settings → Recruitment → Positions → what the public apply form offers.

const positions = [
  { positionId: 'EI', name: 'Junior EI', payRangeMin: 2000, payRangeMax: 2600 },
  { positionId: 'AEI', name: 'Assistant EI', payRangeMin: null, payRangeMax: null },
];

describe('Recruitment positions on the apply form', () => {
  it('names each by its public name or the position’s, with the pay range from Payroll', () => {
    expect(resolveOpenings([{ positionId: 'EI', publicName: 'Junior Teacher' }, { positionId: 'AEI', publicName: '' }], positions)).toEqual([
      { name: 'Junior Teacher', minSalary: 2000, maxSalary: 2600 },
      { name: 'Assistant EI', minSalary: null, maxSalary: null },
    ]);
  });

  it('keeps entries from before positions were linked, and drops a position that no longer exists', () => {
    expect(resolveOpenings([{ name: 'Kindergarten Helper', minSalary: 1700, maxSalary: 2000 }, { positionId: 'GONE' }, 'Cook'], positions)).toEqual([
      { name: 'Kindergarten Helper', minSalary: 1700, maxSalary: 2000 },
      { name: 'Cook', minSalary: null, maxSalary: null },
    ]);
  });
});
