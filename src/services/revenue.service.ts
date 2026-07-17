import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, packages, students, studentEnrollments } from '../db/schema.js';

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

// Enrollment-aware revenue. Each student can have many enrollment periods;
// for any given month we credit whichever period is "active at end of
// month" (cutoff). Withdrawn students are still credited the month they
// left in (matching the existing students-page semantics where mid-month
// withdrawals don't lose that month's revenue retroactively for past
// months — current month uses real-time `now` instead).
const enrollmentRevenueSelect = {
  studentId: studentEnrollments.studentId,
  startDate: studentEnrollments.startDate,
  endDate: studentEnrollments.endDate,
  monthlyFee: studentEnrollments.monthlyFee,
  feeOverridden: studentEnrollments.feeOverridden,
  packageYear: packages.year,
  packagePrice: packages.price,
  studentChildDob: students.childDob,
  leadChildDob: leads.childDob,
};

type EnrollmentRow = {
  studentId: string;
  startDate: Date;
  endDate: Date | null;
  monthlyFee: number;
  feeOverridden: boolean;
  packageYear: number | null;
  packagePrice: number | null;
  studentChildDob: Date | null;
  leadChildDob: Date | null;
};

export async function computeMonthlyRevenue(year: number): Promise<MonthlyRevenueResult> {
  const rows: EnrollmentRow[] = await db
    .select(enrollmentRevenueSelect)
    .from(studentEnrollments)
    .leftJoin(packages, eq(studentEnrollments.packageId, packages.id))
    .leftJoin(students, eq(studentEnrollments.studentId, students.id))
    .leftJoin(leads, eq(students.leadId, leads.id));

  // Group enrollments by student so we can pick the credited period per month.
  const byStudent = new Map<string, EnrollmentRow[]>();
  for (const r of rows) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId)!.push(r);
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = year === currentYear ? now.getMonth() : (year < currentYear ? 11 : -1);

  const months: MonthlyRevenueEntry[] = MONTHS.map((month, i) => {
    let revenue = 0;
    let studentCount = 0;
    const isForecast = year > currentYear || (year === currentYear && i > currentMonthIdx);
    const isCurrentMonth = year === currentYear && i === currentMonthIdx;
    const monthStart = new Date(year, i, 1);
    const cutoff = isCurrentMonth ? now : new Date(year, i + 1, 0, 23, 59, 59);

    // An enrollment "overlaps" the month if it's still alive on at least one
    // day of the month — matches the existing isActiveInMonth semantics so
    // mid-month withdrawals in past months keep their month's revenue.
    const overlaps = (e: EnrollmentRow): boolean => {
      if (e.startDate > cutoff) return false;
      if (e.endDate) {
        if (isCurrentMonth ? e.endDate <= now : e.endDate < monthStart) return false;
      }
      return true;
    };

    // The "credited" period is the one active at end-of-month (cutoff).
    // For mid-month package changes, this picks the new package — end-of-
    // month wins. For mid-month withdrawals there's no period at cutoff
    // (current month) or fall back to the only overlapping period (past).
    const activeAtCutoff = (e: EnrollmentRow): boolean => {
      if (e.startDate > cutoff) return false;
      if (e.endDate && e.endDate <= cutoff) return false;
      return true;
    };

    for (const enrollments of byStudent.values()) {
      const overlapping = enrollments.filter(overlaps);
      if (overlapping.length === 0) continue;
      // Past/current months fall back to the last-closed period so a
      // mid-month withdrawal doesn't retroactively erase revenue that
      // already happened. Forecast months have no history to preserve —
      // if nothing's open through cutoff, the student simply isn't there.
      const credit = overlapping.find(activeAtCutoff) ?? (isForecast ? null : overlapping[overlapping.length - 1]);
      if (!credit) continue;
      // Cash-flow accounting: any active enrollment generates revenue at
      // its monthly fee regardless of which year the package is labelled.
      // We don't filter by package.year — a student paying RM 500/month is
      // worth RM 500 to the school every month they're enrolled, even if
      // they were never rolled over to the current year's package catalog.
      // Graduated at 7 — student is excluded for the year they turn 7.
      const dob = credit.studentChildDob ?? credit.leadChildDob;
      if (dob) {
        const birthYear = dob.getFullYear();
        if (year - birthYear >= 7) continue;
      }
      const fee = credit.feeOverridden ? credit.monthlyFee : (credit.packagePrice ?? 0);
      revenue += fee;
      studentCount++;
    }

    return { monthIdx: i, month, revenue, studentCount, isForecast };
  });

  return { year, currentMonthIdx, months };
}
