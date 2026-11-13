// Profit-sharing (quarterly) and annual-bonus pool maths — pure functions.
//
// The server works out what each teacher sees on their Pay pages (see
// payPools.service.ts) so their phone never downloads the school's finance
// figures. The admin Analysis pages still run the same maths in the browser
// (kindercore-frontend/src/utils/poolMath.ts) for their interactive
// "leave a teacher out" split — a frontend test (poolMath.parity.test.ts)
// runs both copies on the same cases so they can never disagree.

/** Defaults when the Finance settings haven't been saved (mirror FinanceSettingsPage). */
export const DEFAULT_EXPENSE_RATIO_TARGET = 0.8; // 80%
export const DEFAULT_PROFIT_SHARE_PERCENT = 0.04; // 4%
export const DEFAULT_ANNUAL_BONUS_PERCENT = 0.02; // 2%

/** A numeric system setting, or the fallback when it's missing / out of range (lo exclusive, hi inclusive). */
export function settingNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > lo && n <= hi ? n : fallback;
}

export interface PoolFinanceMonth {
  revenue: number;
  staffCost: number;
  operatingCost: number;
  isForecast: boolean;
}

export interface PoolMonth {
  monthIdx: number;
  revenue: number;
  expenses: number;
  ratio: number | null;
  /** True only when actuals confirm the ratio meets target. */
  hit: boolean;
  /** Real contribution to the pool — 0 for forecast months. */
  pool: number;
  /** What this month would add if its ratio holds — the projection for forecast months. */
  projectedPool: number;
  isForecast: boolean;
}

/**
 * One month's contribution: revenue × percent when (staff + operating cost)
 * ÷ revenue is at or under the target. Forecast months never pay out —
 * they only carry a projection until real numbers arrive.
 */
export function monthPool(monthIdx: number, m: PoolFinanceMonth | undefined, expenseTarget: number, percent: number): PoolMonth {
  if (!m) return { monthIdx, revenue: 0, expenses: 0, ratio: null, hit: false, pool: 0, projectedPool: 0, isForecast: true };
  const expenses = m.staffCost + m.operatingCost;
  const ratio = m.revenue > 0 ? expenses / m.revenue : null;
  const wouldQualify = ratio !== null && ratio <= expenseTarget;
  const hit = !m.isForecast && wouldQualify;
  const projectedPool = wouldQualify ? m.revenue * percent : 0;
  return { monthIdx, revenue: m.revenue, expenses, ratio, hit, pool: hit ? projectedPool : 0, projectedPool, isForecast: m.isForecast };
}

export interface WeightMonth { isActive: boolean; weight: number }

/** A teacher's weight over the given months — only months they were active with a positive weight count. */
export function poolWeight(months: (WeightMonth | undefined)[], monthIdxs: number[]): number {
  let w = 0;
  for (const mi of monthIdxs) {
    const m = months[mi];
    if (m && m.isActive && m.weight > 0) w += m.weight;
  }
  return w;
}

/**
 * Split the pool by weight, to the sen. Largest weight first; each share is
 * rounded, and the last (smallest) takes whatever is left so the shares add
 * back up to the pool rather than drifting a sen over or under.
 */
export function splitPool<T extends { weight: number }>(rows: T[], amount: number): Array<T & { share: number; amount: number }> {
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) return rows.map(r => ({ ...r, share: 0, amount: 0 }));
  let allocated = 0;
  return [...rows].sort((a, b) => b.weight - a.weight).map((r, i, ordered) => {
    const raw = (r.weight / totalWeight) * amount;
    const isLast = i === ordered.length - 1;
    const a = isLast ? Math.round(Math.max(0, amount - allocated) * 100) / 100 : Math.round(raw * 100) / 100;
    allocated += a;
    return { ...r, share: r.weight / totalWeight, amount: a };
  });
}
