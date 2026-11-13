// Staff who have left can't use the app. "Left" = their Last Working Day
// (Teacher.resignedAt) is before today — they can still sign in ON their last
// day, and are locked out from the day after. Days are the centre's own
// calendar (Malaysia, UTC+8), so the cut-off is midnight in Malaysia, not UTC.
// Used by login (refuses to sign in) and authMiddleware (ends sessions that
// are already open), so the rule lives in exactly one place.

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Malaysian calendar date of an instant, as 'YYYY-MM-DD'. */
export function malaysiaDate(at: Date): string {
  return new Date(at.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** True once the day after the last working day has started in Malaysia. */
export function hasLeft(resignedAt: Date | null | undefined, now = new Date()): boolean {
  return !!resignedAt && malaysiaDate(resignedAt) < malaysiaDate(now);
}

export const STAFF_LEFT_CODE = 'STAFF_LEFT';

/** What a former staff member is told when they try to sign in. */
export function staffLeftMessage(resignedAt: Date): string {
  const day = new Date(`${malaysiaDate(resignedAt)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `Your last working day was ${day}, so this account can no longer sign in. Please contact the office if this is a mistake.`;
}
