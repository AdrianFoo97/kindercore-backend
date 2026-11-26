// Profit-sharing publishing — the rules, with no database (unit-tested).
// Each publish / unpublish of a month is a row; the latest row for a month is
// its state. Staff see a month's team pool and annual-bonus contribution only
// while it's published, and only the amounts frozen when it was published.

export type PublishAction = 'PUBLISHED' | 'UNPUBLISHED';

export interface PublicationRow {
  year: number;
  month: number;
  action: PublishAction;
  poolAmount: string | number | null;
  annualBonusAmount: string | number | null;
  hit: boolean | null;
  reason: string | null;
  byName: string;
  createdAt: Date;
}

export interface PublishedMonth { monthIdx: number; poolAmount: number; annualBonusAmount: number; hit: boolean; publishedAt: Date; byName: string }

export const MONTHS_IN_YEAR = 12;
/** Longest reason kept for taking a month back. */
export const MAX_UNPUBLISH_REASON = 500;

/** The months of a year that are published right now (the latest row per month says PUBLISHED). */
export function publishedMonths(rows: PublicationRow[], year: number): Map<number, PublishedMonth> {
  const latest = new Map<number, PublicationRow>();
  for (const r of rows.filter(r => r.year === year).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) latest.set(r.month, r);
  const out = new Map<number, PublishedMonth>();
  for (const [monthIdx, r] of latest) {
    if (r.action !== 'PUBLISHED') continue;
    out.set(monthIdx, { monthIdx, poolAmount: Number(r.poolAmount ?? 0), annualBonusAmount: Number(r.annualBonusAmount ?? 0), hit: !!r.hit, publishedAt: r.createdAt, byName: r.byName });
  }
  return out;
}

/** Why a month can't be published now, or null. A month is publishable once it has ended (its figures are actuals, not forecast). */
export function publishProblem(isPublished: boolean, isForecast: boolean): string | null {
  if (isPublished) return 'This month is already published.';
  if (isForecast) return 'This month hasn’t finished yet — publish it once its figures are in.';
  return null;
}

/** Why a month can't be taken back, or null. */
export function unpublishProblem(isPublished: boolean, reason: string): string | null {
  if (!isPublished) return 'This month isn’t published.';
  if (!reason.trim()) return 'Say why it’s being taken back.';
  if (reason.trim().length > MAX_UNPUBLISH_REASON) return `Keep the reason to ${MAX_UNPUBLISH_REASON} characters.`;
  return null;
}

/** RM to the sen — what's frozen when a month is published. */
export const toSen = (amount: number): number => Math.round(amount * 100) / 100;
