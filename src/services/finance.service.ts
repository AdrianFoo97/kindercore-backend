import { computeMonthlyRevenue } from './revenue.service.js';
import { computeMonthlyPayroll } from './payroll.service.js';
import { computeMonthlyOperatingCost } from './operatingCost.service.js';

// The school's month-by-month finance picture (revenue, staff cost,
// operating cost, profit). Finance / Analysis only — teachers get just their
// pool figures, worked out from this on the server (payPools.service.ts).

export interface FinanceMonth {
  month: string;
  revenue: number;
  staffCost: number;
  operatingCost: number;
  profit: number;
  margin: number;
  studentCount: number;
  teacherCount: number;
  isForecast: boolean;
  /** True when operatingCost was substituted with the projected value because
      the month has no saved entries. */
  operatingIsProjected: boolean;
  /** Recorded spend under categories/groups flagged out of the operating
   *  cost sum (e.g. HR Benefits) — doesn't count toward operatingCost/profit. */
  excludedOperatingCost: number;
  /** Salary + employer contributions for teachers flagged
   *  excludeFromStaffCost — doesn't count toward staffCost/profit. */
  excludedStaffCost: number;
}

export async function computeFinanceMonths(year: number): Promise<{ currentMonthIdx: number; months: FinanceMonth[] }> {
  const [revenue, payroll, opCost] = await Promise.all([
    computeMonthlyRevenue(year),
    computeMonthlyPayroll(year),
    computeMonthlyOperatingCost(year),
  ]);

  const months: FinanceMonth[] = revenue.months.map((r, i) => {
    const p = payroll.months[i];
    const o = opCost.months[i];
    const staffCost = Math.round(p.staffCost + p.employerContributions);
    const operatingCost = Math.round(o.projected);
    const rev = Math.round(r.revenue);
    const profit = rev - staffCost - operatingCost;
    return {
      month: r.month,
      revenue: rev,
      staffCost,
      operatingCost,
      profit,
      margin: rev > 0 ? profit / rev : 0,
      studentCount: r.studentCount,
      teacherCount: p.teacherCount,
      isForecast: r.isForecast,
      operatingIsProjected: o.isProjected,
      excludedOperatingCost: Math.round(o.excludedCost),
      excludedStaffCost: Math.round(p.excludedStaffCost),
    };
  });
  // currentMonthIdx comes from revenue/payroll (both compute it the same way).
  return { currentMonthIdx: revenue.currentMonthIdx, months };
}
