import { describe, it, expect } from 'vitest';
import { payRangeProblem } from '../../services/payRange.logic.js';

// Settings → Payroll: a position's total pay range (basic + allowances + incentives).

describe('Pay range by position', () => {
  it('takes no range, or both ends with the bottom at least the basic salary', () => {
    expect(payRangeProblem(2000, null, null)).toBeNull();
    expect(payRangeProblem(2000, 2000, 2600)).toBeNull();
    expect(payRangeProblem(2000, 2200, null)).toMatch(/both ends/);
    expect(payRangeProblem(2000, 1800, 2600)).toMatch(/below the basic salary/);
    expect(payRangeProblem(2000, 2600, 2400)).toMatch(/can’t be below the bottom/);
  });
});
