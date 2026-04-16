import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { operatingCosts } from '../db/schema.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface MonthlyOperatingCostEntry {
  monthIdx: number;
  month: string;
  /** Raw total from the OperatingCost table for this month. */
  operatingCost: number;
  /**
   * Value to display for forecasting: actual (DB total) for past/current months,
   * rolling average across actual months for future months in the current year.
   */
  projected: number;
  isForecast: boolean;
}

export interface MonthlyOperatingCostResult {
  year: number;
  currentMonthIdx: number;
  months: MonthlyOperatingCostEntry[];
}

export async function computeMonthlyOperatingCost(year: number): Promise<MonthlyOperatingCostResult> {
  const rows = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));

  const byMonth = new Map<number, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount);
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  // -1 when year is in the future (no actuals yet); 11 when year is in the past (all actuals).
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  // Forecast = average of completed past-months' totals (Jan through the month
  // BEFORE currentMonthIdx). The current month is in progress so its ad-hoc
  // entries shouldn't drag the projection. Falls back to the raw DB entry if
  // we have no completed past months to average (e.g. January of the year).
  let forecastValue: number | null = null;
  if (currentMonthIdx > 0) {
    let sum = 0;
    for (let i = 0; i < currentMonthIdx; i++) sum += byMonth.get(i) ?? 0;
    forecastValue = sum / currentMonthIdx;
  }

  const months: MonthlyOperatingCostEntry[] = MONTHS.map((month, i) => {
    const actual = byMonth.get(i) ?? 0;
    const isForecast = currentMonthIdx >= 0 && i > currentMonthIdx;
    const projected = isForecast && forecastValue !== null ? forecastValue : actual;
    return { monthIdx: i, month, operatingCost: actual, projected, isForecast };
  });

  return { year, currentMonthIdx, months };
}
