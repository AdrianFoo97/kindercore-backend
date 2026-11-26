// School news — what a post says, with no database (unit-tested).
// First kind: a new child enrols. For everyone to celebrate, so it shares only
// the class and the start date — never the child's name, parents, fees or photo.

export type SchoolNewsKind = 'ENROLMENT';

/** A post goes out only for a child starting now-ish: a past start older than this is an import of old records, not news. */
export const NEWS_MAX_PAST_START_DAYS = 30;
/** How long a post stays on everyone's Home. */
export const NEWS_SHOW_DAYS = 14;
/** At most this many posts on Home. */
export const NEWS_LIST_LIMIT = 5;
/** Setting that turns enrolment posts on or off (Settings → Students → School news). On unless switched off. */
export const ENROLMENT_NEWS_SETTING = 'school_news_enrolments';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Full Day (4Y)" — the programme and the age group the package is for. */
export const classLabel = (pkg: { programme: string; age: number }): string => `${pkg.programme} (${pkg.age}Y)`;

const dayText = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/**
 * The post for a new enrolment, or null when it isn't news (a start date long
 * past — e.g. importing last year's students). `today` and `start` are compared by day.
 */
export function enrolmentNews(pkg: { programme: string; age: number }, start: Date, today: Date): { title: string; body: string } | null {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysPast = Math.round((todayDay - startDay) / DAY_MS);
  if (daysPast > NEWS_MAX_PAST_START_DAYS) return null;
  return {
    title: `A new friend is joining ${classLabel(pkg)}!`,
    body: daysPast > 0 ? `Started ${dayText(start)} — say hello and make them welcome.` : `Starting ${dayText(start)} — let's make them welcome.`,
  };
}

/** Whether the on/off setting allows enrolment posts (missing or anything but false = on). */
export const enrolmentNewsOn = (value: unknown): boolean => value !== false && value !== 'false';

/** Posts shown on Home: not hidden, posted within NEWS_SHOW_DAYS, newest first, at most NEWS_LIST_LIMIT. */
export function visibleNews<T extends { postedAt: Date; hiddenAt: Date | null }>(rows: T[], now: Date): T[] {
  const from = now.getTime() - NEWS_SHOW_DAYS * DAY_MS;
  return rows
    .filter(r => !r.hiddenAt && r.postedAt.getTime() >= from)
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .slice(0, NEWS_LIST_LIMIT);
}
