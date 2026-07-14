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
   * Value to display for forecasting: actual (DB total) for past/current months
   * that have entries; otherwise the rolling average across past months that
   * do have entries.
   */
  projected: number;
  isForecast: boolean;
  /** true when `projected` was substituted because the month has zero entries. */
  isProjected: boolean;
}

export interface MonthlyOperatingCostResult {
  year: number;
  currentMonthIdx: number;
  months: MonthlyOperatingCostEntry[];
}

export async function computeMonthlyOperatingCost(year: number): Promise<MonthlyOperatingCostResult> {
  const rows = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));

  // Every recorded row is real spend. A row whose amount happens to equal its
  // category's defaultAmount is not "unconfirmed" — fixed costs (rent, road tax)
  // legitimately hit the preset value every month. defaultAmount is a prefill for
  // the entry grid and carries no meaning here.
  const byMonth = new Map<number, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount);
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  // -1 when year is in the future (no actuals yet); 11 when year is in the past (all actuals).
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  // Forecast = average of completed past-months that actually HAVE entries.
  // Empty past months (user hasn't recorded yet) would otherwise pull the
  // average toward zero. We also skip the current month since it's in progress.
  let forecastValue: number | null = null;
  if (currentMonthIdx > 0) {
    const pastWithData: number[] = [];
    for (let i = 0; i < currentMonthIdx; i++) {
      if (byMonth.has(i)) pastWithData.push(i);
    }
    if (pastWithData.length > 0) {
      const sum = pastWithData.reduce((s, i) => s + (byMonth.get(i) ?? 0), 0);
      forecastValue = sum / pastWithData.length;
    }
  }

  // projected = actual if the month has any entry; otherwise fall back to the
  // forecast value. Applies to past months with no entries (e.g. user hasn't
  // recorded Mar yet) AND to current/future months without data.
  const months: MonthlyOperatingCostEntry[] = MONTHS.map((month, i) => {
    const actual = byMonth.get(i) ?? 0;
    const isForecast = currentMonthIdx >= 0 && i > currentMonthIdx;
    const hasData = byMonth.has(i);
    const isProjected = !hasData && forecastValue !== null;
    const projected = isProjected ? forecastValue! : actual;
    return { monthIdx: i, month, operatingCost: actual, projected, isForecast, isProjected };
  });

  return { year, currentMonthIdx, months };
}
