import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { operatingCosts, operatingCostCategories } from '../../db/schema.js';

// The service reads via drizzle: db.select().from(t)[.where(...)] — awaited directly.
// Stub that chain so the money logic can be tested without a database.
//
// The stub is deliberately TABLE-AWARE. If it returned the same array for every
// query, a reintroduced preset filter would look up categories, find none, and
// no-op — the regression tests below would pass while the bug was live again.
// Serving real categories (with defaultAmount set) means those tests actually bite.
const rows: { year: number; month: number; categoryId: string; amount: number }[] = [];

const CATEGORIES = [
  { id: 'cat-rent', name: 'Rental', defaultAmount: 4200, monthlyBudget: 4200 },
  { id: 'cat-petrol', name: 'Petrol', defaultAmount: null, monthlyBudget: 550 },
];

vi.mock('../../db/client.js', () => {
  const result = (table: unknown) => {
    const data = table === operatingCostCategories ? CATEGORIES : rows;
    // Awaitable directly (no .where) or after .where(...) — both are used by drizzle.
    return Object.assign(Promise.resolve(data), { where: () => Promise.resolve(data) });
  };
  return { db: { select: () => ({ from: (table: unknown) => result(table) }) } };
});

// A plain import is fine: vitest hoists vi.mock above the imports, so the service
// picks up the stubbed db.
import { computeMonthlyOperatingCost } from '../../services/operatingCost.service.js';

function setRows(next: typeof rows) {
  rows.length = 0;
  rows.push(...next);
}

// Rent's preset (defaultAmount) is 4200 — the exact amount it is recorded at every
// month. That coincidence is what the old code used to throw the row away for.
const RENT = 'cat-rent';
const PETROL = 'cat-petrol';

// Guard the guard: if the schema import ever stops matching what the service
// queries, the table-aware stub silently degrades. Keep it honest.
void operatingCosts;

beforeEach(() => {
  // Pin "today" to 15 Jun 2026 so currentMonthIdx is deterministic (5 = Jun).
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 15));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('computeMonthlyOperatingCost', () => {
  it('counts an entry whose amount equals its category preset', async () => {
    // REGRESSION: rent is a fixed cost recorded at exactly its defaultAmount every
    // month. The service used to discard rows matching the preset, which silently
    // deleted the single largest operating cost from every finance figure and
    // overstated profit by the same amount.
    setRows([
      { year: 2026, month: 0, categoryId: RENT, amount: 4200 },
      { year: 2026, month: 1, categoryId: RENT, amount: 4200 },
    ]);

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.months[0].operatingCost).toBe(4200);
    expect(result.months[1].operatingCost).toBe(4200);
    expect(result.months[0].isProjected).toBe(false);
  });

  it('does not treat a month of preset-valued entries as an empty month', async () => {
    // The same bug had a second head: a month containing only preset-valued rows
    // failed the has-data check and was overwritten by the rolling average.
    setRows([
      { year: 2026, month: 0, categoryId: RENT, amount: 4200 },
      { year: 2026, month: 1, categoryId: RENT, amount: 4200 },
      { year: 2026, month: 2, categoryId: RENT, amount: 4200 },
    ]);

    const result = await computeMonthlyOperatingCost(2026);

    for (const idx of [0, 1, 2]) {
      expect(result.months[idx].isProjected).toBe(false);
      expect(result.months[idx].projected).toBe(4200);
    }
  });

  it('sums every category within a month', async () => {
    setRows([
      { year: 2026, month: 0, categoryId: RENT, amount: 4200 },
      { year: 2026, month: 0, categoryId: PETROL, amount: 500.5 },
    ]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBeCloseTo(4700.5, 6);
  });

  it('projects a month with no entries from the average of the months that have them', async () => {
    setRows([
      { year: 2026, month: 0, categoryId: RENT, amount: 1000 },
      { year: 2026, month: 1, categoryId: RENT, amount: 2000 },
      // Mar–May: nothing recorded.
    ]);

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.months[0].isProjected).toBe(false);
    expect(result.months[3].isProjected).toBe(true);
    expect(result.months[3].projected).toBe(1500); // mean of 1000 and 2000
    expect(result.months[3].operatingCost).toBe(0); // the raw figure stays honest
  });

  it('keeps an empty past month out of the average rather than dragging it toward zero', async () => {
    setRows([
      { year: 2026, month: 0, categoryId: RENT, amount: 3000 },
      // Feb–May unrecorded.
    ]);

    const result = await computeMonthlyOperatingCost(2026);
    // Jan is the only month with data, so the projection is Jan — not 3000/5.
    expect(result.months[4].projected).toBe(3000);
  });

  it('marks months after the current one as forecast', async () => {
    setRows([{ year: 2026, month: 0, categoryId: RENT, amount: 1000 }]);

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.currentMonthIdx).toBe(5);       // June
    expect(result.months[5].isForecast).toBe(false);
    expect(result.months[6].isForecast).toBe(true);
  });

  it('reports zero — not a projection — for a year with no entries at all', async () => {
    setRows([]);

    const result = await computeMonthlyOperatingCost(2026);

    for (const m of result.months) {
      expect(m.operatingCost).toBe(0);
      expect(m.projected).toBe(0);
      expect(m.isProjected).toBe(false); // nothing to project from
    }
  });
});
