import { operatingCostCategoryGroups, operatingCostCategories, operatingCosts } from '../../db/schema.js';

// Test data for the operating-cost tests, typed against the real schema —
// a renamed or newly required column breaks this file at compile time.
//
// The shape exercises every branch of the include cascade
// (group AND category AND entry):
//   Fixed costs (group in)
//     ├ Rental      — in, preset 4200 (recorded at exactly the preset)
//     ├ Petrol      — in, no preset
//     └ Capex       — category marked OUT of the sum
//   One-off (group marked OUT of the sum)
//     └ Renovation  — category in, but its group is out

const NOW = new Date('2026-01-01T00:00:00Z');

export const GROUP = { fixed: 'grp-fixed', oneOff: 'grp-oneoff' } as const;
export const CAT = {
  rent: 'cat-rent',
  petrol: 'cat-petrol',
  capex: 'cat-capex',
  renovation: 'cat-renovation',
} as const;

export const groups: (typeof operatingCostCategoryGroups.$inferInsert)[] = [
  { id: GROUP.fixed, name: 'Fixed costs', sortOrder: 0, includeInOperatingCostSum: true, createdAt: NOW, updatedAt: NOW },
  { id: GROUP.oneOff, name: 'One-off', sortOrder: 1, includeInOperatingCostSum: false, createdAt: NOW, updatedAt: NOW },
];

export const categories: (typeof operatingCostCategories.$inferInsert)[] = [
  { id: CAT.rent, name: 'Rental', groupId: GROUP.fixed, defaultAmount: 4200, monthlyBudget: 4200, includeInOperatingCostSum: true, createdAt: NOW, updatedAt: NOW },
  { id: CAT.petrol, name: 'Petrol', groupId: GROUP.fixed, defaultAmount: null, monthlyBudget: 550, includeInOperatingCostSum: true, createdAt: NOW, updatedAt: NOW },
  { id: CAT.capex, name: 'Capex', groupId: GROUP.fixed, defaultAmount: null, monthlyBudget: null, includeInOperatingCostSum: false, createdAt: NOW, updatedAt: NOW },
  { id: CAT.renovation, name: 'Renovation', groupId: GROUP.oneOff, defaultAmount: null, monthlyBudget: null, includeInOperatingCostSum: true, createdAt: NOW, updatedAt: NOW },
];

let seq = 0;
/** One recorded cost entry. `month` is 0-based (Jan = 0), as stored. */
export function entry(
  month: number, categoryId: string, amount: number,
  opts: { year?: number; include?: boolean } = {},
): typeof operatingCosts.$inferInsert {
  seq += 1;
  return {
    id: `entry-${seq}`, year: opts.year ?? 2026, month, categoryId, amount,
    includeInOperatingCostSum: opts.include ?? true, createdAt: NOW, updatedAt: NOW,
  };
}
