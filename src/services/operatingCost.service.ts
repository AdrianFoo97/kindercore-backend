import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { operatingCosts } from '../db/schema.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface MonthlyOperatingCostEntry {
  monthIdx: number;
  month: string;
  operatingCost: number;
}

export interface MonthlyOperatingCostResult {
  year: number;
  months: MonthlyOperatingCostEntry[];
}

export async function computeMonthlyOperatingCost(year: number): Promise<MonthlyOperatingCostResult> {
  const rows = await db.select().from(operatingCosts).where(eq(operatingCosts.year, year));

  const byMonth = new Map<number, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount);
  }

  const months: MonthlyOperatingCostEntry[] = MONTHS.map((month, i) => ({
    monthIdx: i,
    month,
    operatingCost: byMonth.get(i) ?? 0,
  }));

  return { year, months };
}
