import { Request, Response } from 'express';
import { computeMonthlyRevenue } from '../services/revenue.service.js';
import { computeMonthlyPayroll } from '../services/payroll.service.js';
import { computeMonthlyOperatingCost } from '../services/operatingCost.service.js';

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
}

export async function getFinanceSummary(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();

  const [revenue, payroll, opCost] = await Promise.all([
    computeMonthlyRevenue(year),
    computeMonthlyPayroll(year),
    computeMonthlyOperatingCost(year),
  ]);

  // currentMonthIdx comes from revenue/payroll (both compute it the same way)
  const currentMonthIdx = revenue.currentMonthIdx;

  const months: FinanceMonth[] = revenue.months.map((r, i) => {
    const p = payroll.months[i];
    const o = opCost.months[i];
    const staffCost = Math.round(p.staffCost + p.employerContributions);
    const operatingCost = Math.round(o.projected);
    const rev = Math.round(r.revenue);
    const profit = rev - staffCost - operatingCost;
    const margin = rev > 0 ? profit / rev : 0;
    return {
      month: r.month,
      revenue: rev,
      staffCost,
      operatingCost,
      profit,
      margin,
      studentCount: r.studentCount,
      teacherCount: p.teacherCount,
      isForecast: r.isForecast,
      operatingIsProjected: o.isProjected,
    };
  });

  const sum = (pick: (m: FinanceMonth) => number, filter?: (m: FinanceMonth) => boolean) =>
    months.filter(filter ?? (() => true)).reduce((s, m) => s + pick(m), 0);

  const totals = {
    revenue: sum(m => m.revenue),
    staffCost: sum(m => m.staffCost),
    operatingCost: sum(m => m.operatingCost),
    profit: sum(m => m.profit),
    actual: {
      revenue: sum(m => m.revenue, m => !m.isForecast),
      staffCost: sum(m => m.staffCost, m => !m.isForecast),
      operatingCost: sum(m => m.operatingCost, m => !m.isForecast),
      profit: sum(m => m.profit, m => !m.isForecast),
    },
    forecast: {
      revenue: sum(m => m.revenue, m => m.isForecast),
      staffCost: sum(m => m.staffCost, m => m.isForecast),
      operatingCost: sum(m => m.operatingCost, m => m.isForecast),
      profit: sum(m => m.profit, m => m.isForecast),
    },
  };

  res.json({ year, currentMonthIdx, months, totals });
}
