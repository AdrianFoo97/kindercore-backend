// Appraisal schedules: a staff member on an appraisal form, repeating
// ("every month on the 1st") or once on a date. These are the rules for when
// the next appraisal is due and which period it covers. Pure — the service
// (appraisalSchedules.service) reads and writes the database.

export type ScheduleRepeat = 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export const SCHEDULE_REPEATS: readonly ScheduleRepeat[] = ['ONCE', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

/** Days 29–31 don't exist in every month, so a schedule's day is 1–28. */
export const LAST_SCHEDULE_DAY = 28;
const MONTHS_PER_QUARTER = 3;
const MONTHS_PER_YEAR = 12;
const MALAYSIA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface Day { year: number; month: number; day: number } // month 0–11
export interface Period { year: number; month: number }

export interface ScheduleRule {
  repeat: ScheduleRepeat;
  /** Day of the month it's created on (ONCE: unused — the start date is the day). */
  dayOfMonth: number;
  /** YEARLY: which month (0–11). */
  monthOfYear: number | null;
  /** First day it may create one ('YYYY-MM-DD'). For ONCE, the day it's created. */
  startsOn: string;
  /** The last period it created an appraisal for (periodKey), so it never makes the same one twice. */
  lastPeriodKey: number | null;
}

export const periodKey = (p: Period) => p.year * MONTHS_PER_YEAR + p.month;

export function parseDay(iso: string): Day {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}
export const formatDay = (d: Day) => `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const dayNumber = (d: Day) => Date.UTC(d.year, d.month, d.day);
const before = (a: Day, b: Day) => dayNumber(a) < dayNumber(b);

/** Today in Malaysia. */
export function malaysiaToday(now: Date = new Date()): Day {
  const my = new Date(now.getTime() + MALAYSIA_UTC_OFFSET_MS);
  return { year: my.getUTCFullYear(), month: my.getUTCMonth(), day: my.getUTCDate() };
}

/** The period an appraisal made in this month covers: the month, its quarter, or its year. */
export function periodFor(repeat: ScheduleRepeat, year: number, month: number): Period {
  if (repeat === 'QUARTERLY') return { year, month: month - (month % MONTHS_PER_QUARTER) };
  if (repeat === 'YEARLY') return { year, month: 0 };
  return { year, month };
}

/** The day this period's appraisal is due. */
function dueDayOf(rule: ScheduleRule, period: Period): Day {
  if (rule.repeat === 'ONCE') return parseDay(rule.startsOn);
  const month = rule.repeat === 'YEARLY' ? rule.monthOfYear ?? 0 : period.month;
  return { year: period.year, month, day: rule.dayOfMonth };
}

/**
 * The appraisal to create today, if any: this period's, once its day has come
 * (catching up later in the period if the server was off that day), not before
 * the start date, and never one it already made.
 */
export function dueToday(rule: ScheduleRule, today: Day): { period: Period; dueOn: Day } | null {
  const start = parseDay(rule.startsOn);
  const period = rule.repeat === 'ONCE' ? periodFor('MONTHLY', start.year, start.month) : periodFor(rule.repeat, today.year, today.month);
  const dueOn = dueDayOf(rule, period);
  if (before(today, dueOn) || before(dueOn, start)) return null;
  if (rule.lastPeriodKey != null && periodKey(period) <= rule.lastPeriodKey) return null;
  return { period, dueOn };
}

/** The next day it will create one (today if it's due today), or null when it never will again. */
export function nextDue(rule: ScheduleRule, today: Day): Day | null {
  if (rule.repeat === 'ONCE') {
    return rule.lastPeriodKey != null ? null : (before(parseDay(rule.startsOn), today) ? today : parseDay(rule.startsOn));
  }
  const step = rule.repeat === 'MONTHLY' ? 1 : rule.repeat === 'QUARTERLY' ? MONTHS_PER_QUARTER : MONTHS_PER_YEAR;
  const start = parseDay(rule.startsOn);
  const from = before(today, start) ? start : today;
  // Walk forward period by period (at most two years) to the first one it would still create.
  let period = periodFor(rule.repeat, from.year, from.month);
  for (let i = 0; i < 2 * MONTHS_PER_YEAR; i++) {
    const dueOn = dueDayOf(rule, period);
    const made = rule.lastPeriodKey != null && periodKey(period) <= rule.lastPeriodKey;
    if (!made && !before(dueOn, start)) return before(dueOn, today) ? today : dueOn;
    const m = period.month + step;
    period = { year: period.year + Math.floor(m / MONTHS_PER_YEAR), month: m % MONTHS_PER_YEAR };
  }
  return null;
}

/** What's wrong with a rule as entered, in plain words — null when it's fine. */
export function ruleProblem(rule: Pick<ScheduleRule, 'repeat' | 'dayOfMonth' | 'monthOfYear' | 'startsOn'>): string | null {
  if (!SCHEDULE_REPEATS.includes(rule.repeat)) return 'Pick how often it repeats.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startsOn) || Number.isNaN(Date.parse(rule.startsOn))) return 'Pick a start date.';
  if (rule.repeat === 'ONCE') return null;
  if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > LAST_SCHEDULE_DAY) return `Pick a day from 1 to ${LAST_SCHEDULE_DAY}.`;
  if (rule.repeat === 'YEARLY' && (rule.monthOfYear == null || rule.monthOfYear < 0 || rule.monthOfYear > 11)) return 'Pick the month.';
  return null;
}
