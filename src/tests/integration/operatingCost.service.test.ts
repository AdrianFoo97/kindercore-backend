import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { operatingCostCategoryGroups, operatingCostCategories, operatingCosts } from '../../db/schema.js';
import { computeMonthlyOperatingCost } from '../../services/operatingCost.service.js';
import { resetTables } from './testDb.js';
import { groups, categories, entry, CAT } from '../fixtures/operatingCost.js';

// Runs the real service against the real (test) MySQL database, loaded with
// the fixtures in ../fixtures/operatingCost.ts — so the actual join +
// include-cascade SQL is exercised, not a stand-in for it.

async function seed(entries: ReturnType<typeof entry>[]) {
  if (entries.length) await db.insert(operatingCosts).values(entries);
}

beforeEach(async () => {
  await resetTables(operatingCosts, operatingCostCategories, operatingCostCategoryGroups);
  await db.insert(operatingCostCategoryGroups).values(groups);
  await db.insert(operatingCostCategories).values(categories);
  // Pin "today" to 15 Jun 2026 so currentMonthIdx is deterministic (5 = Jun).
  // Only Date is faked — the MySQL driver still needs real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 15));
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await pool.end();
});

describe('computeMonthlyOperatingCost', () => {
  it('counts an entry whose amount equals its category preset', async () => {
    // REGRESSION: rent is a fixed cost recorded at exactly its defaultAmount every
    // month. The service used to discard rows matching the preset, which silently
    // deleted the single largest operating cost from every finance figure and
    // overstated profit by the same amount.
    await seed([entry(0, CAT.rent, 4200), entry(1, CAT.rent, 4200)]);

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.months[0].operatingCost).toBe(4200);
    expect(result.months[1].operatingCost).toBe(4200);
    expect(result.months[0].isProjected).toBe(false);
  });

  it('does not treat a month of preset-valued entries as an empty month', async () => {
    // The same bug had a second head: a month containing only preset-valued rows
    // failed the has-data check and was overwritten by the rolling average.
    await seed([entry(0, CAT.rent, 4200), entry(1, CAT.rent, 4200), entry(2, CAT.rent, 4200)]);

    const result = await computeMonthlyOperatingCost(2026);

    for (const idx of [0, 1, 2]) {
      expect(result.months[idx].isProjected).toBe(false);
      expect(result.months[idx].projected).toBe(4200);
    }
  });

  it('sums every category within a month', async () => {
    await seed([entry(0, CAT.rent, 4200), entry(0, CAT.petrol, 500.5)]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBeCloseTo(4700.5, 2);
  });

  it('only counts entries for the requested year', async () => {
    await seed([entry(0, CAT.rent, 4200), entry(0, CAT.rent, 9999, { year: 2025 })]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBe(4200);
  });

  it('projects a month with no entries from the average of the months that have them', async () => {
    await seed([entry(0, CAT.rent, 1000), entry(1, CAT.rent, 2000)]); // Mar–May: nothing recorded.

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.months[0].isProjected).toBe(false);
    expect(result.months[3].isProjected).toBe(true);
    expect(result.months[3].projected).toBe(1500); // mean of 1000 and 2000
    expect(result.months[3].operatingCost).toBe(0); // the raw figure stays honest
  });

  it('keeps an empty past month out of the average rather than dragging it toward zero', async () => {
    await seed([entry(0, CAT.rent, 3000)]); // Feb–May unrecorded.

    const result = await computeMonthlyOperatingCost(2026);
    // Jan is the only month with data, so the projection is Jan — not 3000/5.
    expect(result.months[4].projected).toBe(3000);
  });

  it('marks months after the current one as forecast', async () => {
    await seed([entry(0, CAT.rent, 1000)]);

    const result = await computeMonthlyOperatingCost(2026);

    expect(result.currentMonthIdx).toBe(5); // June
    expect(result.months[5].isForecast).toBe(false);
    expect(result.months[6].isForecast).toBe(true);
  });

  // Exclusion cascades: group.include AND category.include AND entry.include.
  // Excluded spend leaves the operating cost sum (and so the projection
  // average) but is still reported as excludedCost — never silently dropped.
  it('moves an entry marked out of the sum into excludedCost', async () => {
    // (One entry per category per month — the table enforces it.)
    await seed([entry(0, CAT.rent, 4200), entry(0, CAT.petrol, 120, { include: false })]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBe(4200);
    expect(result.months[0].excludedCost).toBe(120);
  });

  it('excludes every entry of a category marked out, even if the entry says include', async () => {
    await seed([entry(0, CAT.rent, 4200), entry(0, CAT.capex, 9000, { include: true })]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBe(4200);
    expect(result.months[0].excludedCost).toBe(9000);
  });

  it('excludes every entry under a group marked out, even if its category says include', async () => {
    await seed([entry(0, CAT.rent, 4200), entry(0, CAT.renovation, 15000)]);

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[0].operatingCost).toBe(4200);
    expect(result.months[0].excludedCost).toBe(15000);
  });

  it('keeps excluded spend out of the projection average', async () => {
    await seed([entry(0, CAT.rent, 1000), entry(0, CAT.capex, 50000)]); // one-off, out of the sum

    const result = await computeMonthlyOperatingCost(2026);
    expect(result.months[3].isProjected).toBe(true);
    expect(result.months[3].projected).toBe(1000);
  });

  it('treats a month with only excluded spend as having no operating cost data', async () => {
    await seed([entry(0, CAT.rent, 1000), entry(1, CAT.capex, 8000)]);

    const result = await computeMonthlyOperatingCost(2026);
    // Feb has excluded spend only → projected from Jan, but excludedCost still shown.
    expect(result.months[1].isProjected).toBe(true);
    expect(result.months[1].projected).toBe(1000);
    expect(result.months[1].excludedCost).toBe(8000);
  });

  it('reports zero — not a projection — for a year with no entries at all', async () => {
    const result = await computeMonthlyOperatingCost(2026);

    for (const m of result.months) {
      expect(m.operatingCost).toBe(0);
      expect(m.projected).toBe(0);
      expect(m.isProjected).toBe(false); // nothing to project from
    }
  });
});
