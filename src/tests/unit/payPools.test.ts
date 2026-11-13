import { describe, it, expect } from 'vitest';
import { monthPool, poolWeight, settingNum, splitPool } from '../../services/poolMath.service.js';
import { poolProgress, quarterMonths } from '../../services/payPools.service.js';
import { noStoreApi } from '../../middlewares/noStore.middleware.js';

// Profit-sharing / annual-bonus pools are real RM paid to staff. The server
// works out each teacher's view so their phone never receives the school's
// finance figures. Same cases as the frontend's poolMath tests.

const month = (revenue: number, staffCost: number, operatingCost: number, isForecast = false) =>
  ({ revenue, staffCost, operatingCost, isForecast });

describe('Pools on the server — which months pay in', () => {
  it('pays into the pool only in a month whose costs are within the target', () => {
    expect(monthPool(0, month(50_000, 20_000, 5_000), 0.6, 0.05)).toMatchObject({ hit: true, pool: 2_500, ratio: 0.5 });
    expect(monthPool(1, month(50_000, 30_000, 5_000), 0.6, 0.05)).toMatchObject({ hit: false, pool: 0, projectedPool: 0 });
    expect(monthPool(0, month(10_000, 6_000, 0), 0.6, 0.1).pool).toBe(1_000);
  });

  it('pays nothing for a forecast month or a month with no figures', () => {
    expect(monthPool(0, month(50_000, 20_000, 5_000, true), 0.6, 0.05)).toMatchObject({ hit: false, pool: 0, projectedPool: 2_500 });
    expect(monthPool(3, undefined, 0.6, 0.05)).toMatchObject({ monthIdx: 3, pool: 0, isForecast: true });
    expect(settingNum(0, 0, 1, 0.05)).toBe(0.05);
  });

  it('splits by weight to the sen, counting only active months', () => {
    expect(poolWeight([{ isActive: true, weight: 1 }, { isActive: false, weight: 1 }, { isActive: true, weight: 0.5 }], [0, 1, 2])).toBe(1.5);
    expect(splitPool([{ weight: 1 }, { weight: 1 }, { weight: 1 }], 100).map(r => r.amount)).toEqual([33.33, 33.33, 33.34]);
  });
});

describe('Pools on the server — what a teacher is sent', () => {
  // Q4: Oct hit (50k revenue, 50% costs), Nov missed (90%), Dec still a forecast. 5% share, 80% target.
  const finance = Array.from({ length: 12 }, () => undefined as ReturnType<typeof month> | undefined);
  finance[9] = month(50_000, 20_000, 5_000);
  finance[10] = month(40_000, 30_000, 6_000);
  finance[11] = month(45_000, 10_000, 5_000, true);
  const active = (w: number) => Array.from({ length: 12 }, () => ({ isActive: true, weight: w }));
  const team = [{ teacherId: 'me', months: active(1) }, { teacherId: 'colleague', months: active(3) }];

  it('works out the pool and the teacher\'s own share exactly as the admin page does', () => {
    const p = poolProgress(finance, team, quarterMonths(3), 0.8, 0.05, 'me');
    expect(p).toMatchObject({ poolAmount: 2_500, hitsCount: 1, elapsedCount: 2, isEligible: true, myShare: 625, mySharePct: 25 });
    expect(p.months).toEqual([
      { monthIdx: 9, hit: true, isForecast: false },
      { monthIdx: 10, hit: false, isForecast: false },
      { monthIdx: 11, hit: false, isForecast: true },
    ]);
  });

  it('never sends the school\'s revenue, costs or colleagues\' weights — only the pool and the teacher\'s own share', () => {
    const sent = JSON.stringify(poolProgress(finance, team, quarterMonths(3), 0.8, 0.05, 'me'));
    for (const secret of ['revenue', 'staffCost', 'operatingCost', 'expenses', 'ratio', 'projectedPool', 'colleague', 'weight', '50000', '40000']) {
      expect(sent, secret).not.toContain(secret);
    }
  });

  it('shows someone with no weight in the period as not eligible, with no share', () => {
    const p = poolProgress(finance, [{ teacherId: 'colleague', months: active(1) }], quarterMonths(3), 0.8, 0.05, 'me');
    expect(p).toMatchObject({ isEligible: false, myShare: 0, mySharePct: 0, poolAmount: 2_500 });
  });
});

describe('API responses are never stored', () => {
  it('tells browsers and proxies not to keep any API response', () => {
    const headers: Record<string, string> = {};
    let passed = false;
    noStoreApi({} as never, { setHeader: (k: string, v: string) => { headers[k] = v; } } as never, () => { passed = true; });
    expect(headers['Cache-Control']).toBe('no-store');
    expect(passed).toBe(true);
  });
});
