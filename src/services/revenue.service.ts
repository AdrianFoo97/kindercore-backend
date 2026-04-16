import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, packages, students } from '../db/schema.js';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

// Shared gatekeeper: is this student counted as revenue-generating for a given month?
// Matches the Students page "active in month" semantics:
//   - Current month uses "now" as cutoff (so same-day withdrawals remove the student immediately).
//   - Past/future months use end-of-month for start, start-of-month for withdrawal.
//   - Graduated at 7: year - birthYear >= 7 → excluded.
export function isActiveInMonth(row: any, year: number, month: number): boolean {
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const monthStart = new Date(year, month, 1);
  const cutoff = isCurrentMonth ? now : new Date(year, month + 1, 0, 23, 59, 59);
  if (!row.startDate || new Date(row.startDate) > cutoff) return false;
  if (row.withdrawnAt) {
    const w = new Date(row.withdrawnAt);
    if (isCurrentMonth ? w <= now : w < monthStart) return false;
  }
  const dob = row.studentChildDob ?? row.leadChildDob;
  if (dob) {
    const birthYear = new Date(dob).getFullYear();
    if (year - birthYear >= 7) return false;
  }
  return true;
}

export function studentMonthlyPrice(s: any): number {
  if (s.feeOverridden) return s.monthlyFee ?? 0;
  return s.packagePrice ?? 0;
}

export interface MonthlyRevenueEntry {
  monthIdx: number;
  month: string;
  revenue: number;
  studentCount: number;
  isForecast: boolean;
}

export interface MonthlyRevenueResult {
  year: number;
  currentMonthIdx: number;
  months: MonthlyRevenueEntry[];
}

const revenueSelect = {
  startDate: students.startDate,
  withdrawnAt: students.withdrawnAt,
  monthlyFee: students.monthlyFee,
  feeOverridden: students.feeOverridden,
  ageOffset: students.ageOffset,
  studentChildDob: students.childDob,
  leadChildDob: leads.childDob,
  packageYear: packages.year,
  packagePrice: packages.price,
};

export async function computeMonthlyRevenue(year: number): Promise<MonthlyRevenueResult> {
  const rows = await db
    .select(revenueSelect)
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id))
    .leftJoin(packages, eq(students.packageId, packages.id));

  const yearRows = rows.filter(r => r.packageYear === year);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  const months: MonthlyRevenueEntry[] = MONTHS.map((month, i) => {
    let revenue = 0;
    let studentCount = 0;
    const isForecast = year > currentYear || (year === currentYear && i > currentMonthIdx);
    for (const s of yearRows) {
      if (isActiveInMonth(s, year, i)) {
        revenue += studentMonthlyPrice(s);
        studentCount++;
      }
    }
    return { monthIdx: i, month, revenue, studentCount, isForecast };
  });

  return { year, currentMonthIdx, months };
}
