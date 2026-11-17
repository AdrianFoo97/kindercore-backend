import { describe, it, expect } from 'vitest';
import { payRangeProblem } from '../../services/payRange.logic.js';

// Settings → Payroll: a position's total pay range (basic + allowances + incentives).

describe('Pay range by position', () => {
  it('takes no range, or both ends with the top not below the bottom', () => {
    expect(payRangeProblem(null, null)).toBeNull();
    expect(payRangeProblem(2000, 2600)).toBeNull();
    expect(payRangeProblem(1700, 2000)).toBeNull(); // may start below the basic salary
    expect(payRangeProblem(2200, null)).toMatch(/both ends/);
    expect(payRangeProblem(2600, 2400)).toMatch(/can’t be below the bottom/);
  });
});
