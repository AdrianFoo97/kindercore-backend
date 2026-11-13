// Appraisal averages — one definition used everywhere: the staff record's
// Appraisals tab, HR → Appraisals, the teacher's own Appraisal page and the
// "average appraisal > 75%" promotion gate.
//
// The average covers the 12 calendar months up to and including the
// reference month (normally this month, Malaysia time). Months with no
// appraisal are simply not counted — they don't drag the average to zero.

export const APPRAISAL_AVG_WINDOW = 12;
export const APPRAISAL_PASS_THRESHOLD = 75;
const MALAYSIA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/** A calendar month; `month` is 0–11 to match the TeacherAppraisal table and JS dates. */
export interface YearMonth { year: number; month: number }

export interface AppraisalAverage {
  average: number | null;
  recordCount: number;
  windowSize: number;
}

/** This month in Malaysia — on the 1st at 7am it's already the new month. */
export function currentMalaysiaMonth(now: Date = new Date()): YearMonth {
  const my = new Date(now.getTime() + MALAYSIA_UTC_OFFSET_MS);
  return { year: my.getUTCFullYear(), month: my.getUTCMonth() };
}

const monthNumber = (ym: YearMonth) => ym.year * 12 + ym.month;

/** True when `ym` falls in the 12 months ending with `end` (inclusive). */
export function isInAverageWindow(ym: YearMonth, end: YearMonth): boolean {
  const gap = monthNumber(end) - monthNumber(ym);
  return gap >= 0 && gap < APPRAISAL_AVG_WINDOW;
}

/** Their most recent appraisal before `month` — shown as "previous mark" when recording that month. */
export function previousAppraisal<T extends YearMonth>(rows: T[], month: YearMonth): T | null {
  const before = rows.filter(r => monthNumber(r) < monthNumber(month));
  if (before.length === 0) return null;
  return before.reduce((latest, r) => (monthNumber(r) > monthNumber(latest) ? r : latest));
}

/** Average score over the 12 months ending with `end`, rounded to a whole percent. */
export function averageOverWindow(rows: (YearMonth & { score: number })[], end: YearMonth): AppraisalAverage {
  const inWindow = rows.filter(r => isInAverageWindow(r, end));
  if (inWindow.length === 0) return { average: null, recordCount: 0, windowSize: APPRAISAL_AVG_WINDOW };
  const sum = inWindow.reduce((acc, r) => acc + r.score, 0);
  return { average: Math.round(sum / inWindow.length), recordCount: inWindow.length, windowSize: APPRAISAL_AVG_WINDOW };
}
