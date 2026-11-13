import { malaysiaDate } from './staffAccess.service.js';

// The shopping list runs Monday → Sunday on the centre's own (Malaysian)
// calendar. A week is named by its Monday, 'YYYY-MM-DD'.

const DAY_MS = 24 * 60 * 60 * 1000;
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The Monday (Malaysian date) of the week containing `at`. */
export function weekStartOf(at: Date): string {
  const day = new Date(`${malaysiaDate(at)}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % DAYS_IN_WEEK; // Mon = 0 … Sun = 6
  return new Date(day.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The instants a week covers: from Monday 00:00 to the next Monday 00:00, Malaysia time. */
export function weekRange(weekStart: string): { from: Date; to: Date } {
  const from = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() - MALAYSIA_OFFSET_MS);
  return { from, to: new Date(from.getTime() + DAYS_IN_WEEK * DAY_MS) };
}

/** What the week's bought items cost (RM, to the sen), and how many have no cost entered yet. */
export function weekSpend(items: { cost: string | number | null }[]): { total: number; uncosted: number } {
  const SEN_PER_RM = 100;
  let sen = 0;
  let uncosted = 0;
  for (const i of items) {
    if (i.cost == null) { uncosted += 1; continue; }
    sen += Math.round(Number(i.cost) * SEN_PER_RM);
  }
  return { total: sen / SEN_PER_RM, uncosted };
}

/** A valid week name from the query string (any date snaps to its Monday), else this week. */
export function parseWeek(raw: unknown, now = new Date()): string {
  if (typeof raw !== 'string' || !WEEK_RE.test(raw)) return weekStartOf(now);
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return weekStartOf(now);
  return weekStartOf(d); // midnight UTC is 8am the same day in Malaysia
}
