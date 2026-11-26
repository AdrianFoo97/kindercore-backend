import { describe, it, expect } from 'vitest';
import { publishProblem, publishedMonths, toSen, unpublishProblem, type PublicationRow } from '../../services/profitSharePublish.logic.js';
import { publishedPoolProgress } from '../../services/payPools.service.js';

// Profit sharing — publishing a month: the rules on their own (no database).

const row = (month: number, action: PublicationRow['action'], at: string, poolAmount: number | null = null, hit: boolean | null = null): PublicationRow =>
  ({ year: 2026, month, action, poolAmount, annualBonusAmount: poolAmount === null ? null : poolAmount / 2, hit, reason: action === 'UNPUBLISHED' ? 'Wrong costs' : null, byName: 'Fiona', createdAt: new Date(at) });

describe('Profit sharing — publishing a month', () => {
  it('counts a month as published only while its latest action is a publish, at the amount frozen then', () => {
    const rows = [
      row(0, 'PUBLISHED', '2026-02-02', 1200, true),
      row(1, 'PUBLISHED', '2026-03-02', 900, true), row(1, 'UNPUBLISHED', '2026-03-05'),
      row(2, 'PUBLISHED', '2026-04-02', 500, true), row(2, 'UNPUBLISHED', '2026-04-03'), row(2, 'PUBLISHED', '2026-04-04', 650, true),
    ];
    const p = publishedMonths(rows, 2026);
    expect([...p.keys()].sort()).toEqual([0, 2]);
    expect(p.get(2)).toMatchObject({ poolAmount: 650, annualBonusAmount: 325, hit: true });
    expect(publishedMonths(rows, 2025).size).toBe(0);
  });

  it('publishes only a finished month that isn’t already published, and takes one back only with a reason', () => {
    expect(publishProblem(false, false)).toBeNull();
    expect(publishProblem(true, false)).toMatch(/already published/);
    expect(publishProblem(false, true)).toMatch(/hasn’t finished/);
    expect(unpublishProblem(true, 'Costs were entered twice')).toBeNull();
    expect(unpublishProblem(true, '   ')).toMatch(/why/);
    expect(unpublishProblem(false, 'x')).toMatch(/isn’t published/);
    expect(toSen(123.456)).toBe(123.46);
  });

  it('shows staff only the published months of a quarter — a month not published yet adds nothing to the pool', () => {
    const team = [
      { teacherId: 't1', months: [{ isActive: true, weight: 3 }, { isActive: true, weight: 3 }, { isActive: true, weight: 3 }] },
      { teacherId: 't2', months: [{ isActive: true, weight: 1 }, { isActive: true, weight: 1 }, { isActive: true, weight: 1 }] },
    ];
    const p = publishedPoolProgress(new Map([[0, { poolAmount: 1000, hit: true }]]), team, [0, 1, 2], 't1');
    expect(p.months).toEqual([
      { monthIdx: 0, hit: true, isForecast: false, published: true },
      { monthIdx: 1, hit: false, isForecast: true, published: false },
      { monthIdx: 2, hit: false, isForecast: true, published: false },
    ]);
    expect(p).toMatchObject({ poolAmount: 1000, hitsCount: 1, elapsedCount: 1, myShare: 750, mySharePct: 75 });
    expect(publishedPoolProgress(new Map(), team, [0, 1, 2], 't1')).toMatchObject({ poolAmount: 0, myShare: 0, elapsedCount: 0 });
  });
});
