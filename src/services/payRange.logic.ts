// Settings → Payroll: a position's total pay range — basic salary plus every kind of
// allowance and incentive — next to its basic salary (which has no allowances).

/** What's wrong with a position's pay range — or null. No range (both empty) is fine. */
export function payRangeProblem(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null || max == null) return 'Give both ends of the pay range, or neither.';
  if (max < min) return 'The top of the pay range can’t be below the bottom.';
  return null;
}
