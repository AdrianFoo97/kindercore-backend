import { inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';
import { computeFinanceMonths } from './finance.service.js';
import { computeTeacherWeightsByMonth } from './payroll.service.js';
import {
  DEFAULT_ANNUAL_BONUS_PERCENT, DEFAULT_EXPENSE_RATIO_TARGET, DEFAULT_PROFIT_SHARE_PERCENT,
  monthPool, poolWeight, settingNum, splitPool, type PoolFinanceMonth, type WeightMonth,
} from './poolMath.service.js';

// A teacher's profit-share and annual-bonus progress, worked out on the
// server. The response carries ONLY what the teacher's Pay / Home pages show
// — each month hit / missed / upcoming, the pool so far, their own share —
// never the school's revenue, costs, profit, or colleagues' weights. (Before
// this, every teacher's phone downloaded the full finance summary and every
// colleague's position and weight to do this maths itself.)

export const MONTHS_IN_QUARTER = 3;
export const YEAR_MONTHS = Array.from({ length: 12 }, (_, i) => i);
export const quarterMonths = (quarterIdx: number) =>
  Array.from({ length: MONTHS_IN_QUARTER }, (_, i) => quarterIdx * MONTHS_IN_QUARTER + i);

export interface PoolMonthStatus { monthIdx: number; hit: boolean; isForecast: boolean }

export interface PoolProgress {
  months: PoolMonthStatus[];
  /** RM paid into the pool so far (confirmed months only). */
  poolAmount: number;
  hitsCount: number;
  elapsedCount: number;
  isEligible: boolean;
  /** This teacher's estimated RM share of poolAmount. */
  myShare: number;
  /** Their weight as a whole-number % of the team's. */
  mySharePct: number;
}

/** One pool (a quarter, or the year) seen by one teacher — pure, so it's unit-tested. */
export function poolProgress(
  finance: (PoolFinanceMonth | undefined)[],
  team: { teacherId: string; months: (WeightMonth | undefined)[] }[],
  monthIdxs: number[],
  expenseTarget: number,
  percent: number,
  teacherId: string,
): PoolProgress {
  const pools = monthIdxs.map(mi => monthPool(mi, finance[mi], expenseTarget, percent));
  const poolAmount = pools.reduce((s, m) => s + m.pool, 0);
  // Split exactly as the admin Profit Sharing / Annual Bonus pages do, so "my share" matches what's paid.
  const weights = team.map(t => ({ teacherId: t.teacherId, weight: poolWeight(t.months, monthIdxs) })).filter(t => t.weight > 0);
  const totalWeight = weights.reduce((s, t) => s + t.weight, 0);
  const myWeight = weights.find(t => t.teacherId === teacherId)?.weight ?? 0;
  return {
    months: pools.map(m => ({ monthIdx: m.monthIdx, hit: m.hit, isForecast: m.isForecast })),
    poolAmount,
    hitsCount: pools.filter(m => m.hit).length,
    elapsedCount: pools.filter(m => !m.isForecast).length,
    isEligible: myWeight > 0,
    myShare: splitPool(weights, poolAmount).find(t => t.teacherId === teacherId)?.amount ?? 0,
    mySharePct: totalWeight > 0 ? Math.round((myWeight / totalWeight) * 100) : 0,
  };
}

const POOL_SETTING_KEYS = ['expense_ratio_target', 'profit_share_percent', 'annual_bonus_percent'];

async function poolSettings() {
  const rows = await db.select().from(systemSettings).where(inArray(systemSettings.key, POOL_SETTING_KEYS));
  const raw = (key: string) => {
    const v = rows.find(r => r.key === key)?.value;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  return {
    expenseTarget: settingNum(raw('expense_ratio_target'), 0, 2, DEFAULT_EXPENSE_RATIO_TARGET),
    profitSharePct: settingNum(raw('profit_share_percent'), 0, 1, DEFAULT_PROFIT_SHARE_PERCENT),
    annualBonusPct: settingNum(raw('annual_bonus_percent'), 0, 1, DEFAULT_ANNUAL_BONUS_PERCENT),
  };
}

/** This quarter's team pool and this year's annual bonus, as one teacher sees them. */
export async function teacherPayPools(teacherId: string, year: number, quarterIdx: number) {
  const [{ months: finance }, weights, s] = await Promise.all([
    computeFinanceMonths(year), computeTeacherWeightsByMonth(year), poolSettings(),
  ]);
  const team = weights.teachers.map(t => ({ teacherId: t.teacherId, months: t.months }));
  return {
    year,
    quarterIdx,
    teamPool: poolProgress(finance, team, quarterMonths(quarterIdx), s.expenseTarget, s.profitSharePct, teacherId),
    annualBonus: poolProgress(finance, team, YEAR_MONTHS, s.expenseTarget, s.annualBonusPct, teacherId),
  };
}
