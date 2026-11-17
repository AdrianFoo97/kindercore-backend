// Settings → Recruitment → Positions: the roles the public apply form offers.
// Each one is a real position (Settings → Positions); its name on the form is the
// position's name unless a public name is given, and its pay range is the one set
// in Settings → Payroll. Entries from before positions were linked (just a name and
// a band) keep working until they're linked.

export interface OpeningPosition { positionId: string; name: string; payRangeMin: number | null; payRangeMax: number | null }
/** What the apply form shows: the role's name and its pay range. */
export interface FormOpening { name: string; minSalary: number | null; maxSalary: number | null }

const band = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);

/** The stored list → what the apply form offers, in order. A linked position that no longer exists is left out. */
export function resolveOpenings(stored: unknown, positions: OpeningPosition[]): FormOpening[] {
  if (!Array.isArray(stored)) return [];
  const out: FormOpening[] = [];
  for (const item of stored) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ name: item.trim(), minSalary: null, maxSalary: null });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.positionId === 'string') {
      const pos = positions.find(p => p.positionId === rec.positionId);
      if (!pos) continue;
      const publicName = typeof rec.publicName === 'string' ? rec.publicName.trim() : '';
      out.push({ name: publicName || pos.name, minSalary: pos.payRangeMin, maxSalary: pos.payRangeMax });
      continue;
    }
    // From before positions were linked: its own name and band.
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (name) out.push({ name, minSalary: band(rec.minSalary), maxSalary: band(rec.maxSalary) });
  }
  return out;
}
