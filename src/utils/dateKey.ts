// Calendar-date string ("YYYY-MM-DD") helpers, anchored to Malaysia time —
// this app has exactly one school, in one timezone, so "today" should mean
// Malaysia's today regardless of which timezone the server container
// happens to be running in (Docker defaults to UTC). Used for comparing
// MarketingCampaign date ranges as plain calendar dates instead of JS Date
// instants: comparing `new Date()` (server-local midnight) against a stored
// UTC-midnight Date previously put the two several hours apart depending on
// server timezone, which could reject a code on its own start date during
// the early-morning hours in Malaysia, or similar edge cases around the
// end date.

export function todayInMalaysia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// MarketingCampaign.startDate/endDate are stored at UTC midnight of the
// calendar date an admin picked, so slicing the UTC ISO string recovers
// that exact date regardless of server timezone.
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
