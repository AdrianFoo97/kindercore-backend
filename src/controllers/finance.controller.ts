import { Request, Response } from 'express';
import { computeFinanceMonths, type FinanceMonth } from '../services/finance.service.js';
import { teacherPayPools } from '../services/payPools.service.js';
import { malaysiaDate } from '../services/staffAccess.service.js';

export type { FinanceMonth };

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const QUARTERS = 4;

/**
 * A teacher's own team-pool and annual-bonus progress (their Pay / Home
 * pages). Only pool figures and their own share — never the school's
 * finance numbers or colleagues' weights. Defaults to this quarter in Malaysia.
 */
export async function getTeacherPayPools(req: Request, res: Response): Promise<void> {
  const today = malaysiaDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const thisQuarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const year = req.query.year === undefined ? thisYear : Number(req.query.year);
  const quarter = req.query.quarter === undefined ? thisQuarter : Number(req.query.quarter);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || !Number.isInteger(quarter) || quarter < 0 || quarter >= QUARTERS) {
    res.status(400).json({ message: 'Pick a valid year and quarter.' });
    return;
  }
  res.json(await teacherPayPools(req.params.teacherId, year, quarter));
}

/** The school's finance summary for a year — Finance / Analysis only (see finance.routes). */
export async function getFinanceSummary(req: Request, res: Response): Promise<void> {
  const year = Number(req.query.year) || new Date().getFullYear();
  const { currentMonthIdx, months } = await computeFinanceMonths(year);

  const sum = (pick: (m: FinanceMonth) => number, filter?: (m: FinanceMonth) => boolean) =>
    months.filter(filter ?? (() => true)).reduce((s, m) => s + pick(m), 0);

  const totals = {
    revenue: sum(m => m.revenue),
    staffCost: sum(m => m.staffCost),
    operatingCost: sum(m => m.operatingCost),
    profit: sum(m => m.profit),
    excludedOperatingCost: sum(m => m.excludedOperatingCost),
    excludedStaffCost: sum(m => m.excludedStaffCost),
    actual: {
      revenue: sum(m => m.revenue, m => !m.isForecast),
      staffCost: sum(m => m.staffCost, m => !m.isForecast),
      operatingCost: sum(m => m.operatingCost, m => !m.isForecast),
      profit: sum(m => m.profit, m => !m.isForecast),
      excludedOperatingCost: sum(m => m.excludedOperatingCost, m => !m.isForecast),
      excludedStaffCost: sum(m => m.excludedStaffCost, m => !m.isForecast),
    },
    forecast: {
      revenue: sum(m => m.revenue, m => m.isForecast),
      staffCost: sum(m => m.staffCost, m => m.isForecast),
      operatingCost: sum(m => m.operatingCost, m => m.isForecast),
      profit: sum(m => m.profit, m => m.isForecast),
      excludedOperatingCost: sum(m => m.excludedOperatingCost, m => m.isForecast),
      excludedStaffCost: sum(m => m.excludedStaffCost, m => m.isForecast),
    },
  };

  res.json({ year, currentMonthIdx, months, totals });
}
