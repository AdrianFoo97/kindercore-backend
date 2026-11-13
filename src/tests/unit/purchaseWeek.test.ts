import { describe, it, expect } from 'vitest';
import { parseWeek, weekRange, weekSpend, weekStartOf } from '../../services/purchaseWeek.service.js';
import { parseCost } from '../../controllers/purchase-requests.controller.js';

// The shopping list runs Monday → Sunday, Malaysia time. 2026-11-09 is a Monday.

describe('Shopping list — weeks, cost and spend', () => {
  it('puts every day Monday to Sunday in the same week, on Malaysian time', () => {
    expect(weekStartOf(new Date('2026-11-09T01:00:00Z'))).toBe('2026-11-09'); // Mon 9am
    expect(weekStartOf(new Date('2026-11-15T15:59:00Z'))).toBe('2026-11-09'); // Sun 11:59pm
    expect(weekStartOf(new Date('2026-11-15T16:00:00Z'))).toBe('2026-11-16'); // Mon 00:00 next week
    expect(weekStartOf(new Date('2026-11-08T17:00:00Z'))).toBe('2026-11-09'); // Mon 1am, still Sunday in UTC
  });

  it('covers Monday midnight to the next Monday midnight, Malaysia time', () => {
    const { from, to } = weekRange('2026-11-09');
    expect(from.toISOString()).toBe('2026-11-08T16:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-15T16:00:00.000Z');
  });

  it('snaps any date to its Monday, and falls back to this week for nonsense', () => {
    const now = new Date('2026-11-11T04:00:00Z'); // Wed
    expect(parseWeek('2026-11-13', now)).toBe('2026-11-09');
    expect(parseWeek('2026-11-09', now)).toBe('2026-11-09');
    expect(parseWeek(undefined, now)).toBe('2026-11-09');
    expect(parseWeek('next tuesday', now)).toBe('2026-11-09');
  });

  it('adds up what the week cost to the sen, and counts items with no cost yet', () => {
    expect(weekSpend([{ cost: '12.50' }, { cost: '0.10' }, { cost: '0.20' }, { cost: null }])).toEqual({ total: 12.8, uncosted: 1 });
    expect(weekSpend([])).toEqual({ total: 0, uncosted: 0 });
  });

  it('accepts a cost in RM, or none, and refuses anything else', () => {
    expect(parseCost('12.5')).toEqual({ ok: true, value: '12.50' });
    expect(parseCost('')).toEqual({ ok: true, value: null });
    expect(parseCost(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseCost('-3').ok).toBe(false);
    expect(parseCost('abc').ok).toBe(false);
    expect(parseCost('1000000').ok).toBe(false);
  });
});
