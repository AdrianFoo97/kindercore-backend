import { describe, it, expect } from 'vitest';
import { hasLeft, malaysiaDate, staffLeftMessage } from '../../services/staffAccess.service.js';

// Staff can't use the app once their Last Working Day has passed. The date
// picker saves the day as midnight UTC; the cut-off is midnight in Malaysia.

const LAST_DAY = new Date('2026-11-10T00:00:00Z'); // "Last Working Day: 10 Nov 2026"

describe('Staff access — locked out after the last working day', () => {
  it('still lets them in on their last working day, right up to midnight in Malaysia', () => {
    expect(hasLeft(LAST_DAY, new Date('2026-11-10T01:00:00Z'))).toBe(false); // 9am on the 10th
    expect(hasLeft(LAST_DAY, new Date('2026-11-10T15:59:00Z'))).toBe(false); // 11:59pm on the 10th
  });

  it('locks them out from the day after', () => {
    expect(hasLeft(LAST_DAY, new Date('2026-11-10T16:00:00Z'))).toBe(true); // midnight, the 11th
    expect(hasLeft(LAST_DAY, new Date('2027-01-01T00:00:00Z'))).toBe(true);
  });

  it('never locks out someone with no last working day, or one still in the future', () => {
    expect(hasLeft(null, new Date('2026-11-10T00:00:00Z'))).toBe(false);
    expect(hasLeft(LAST_DAY, new Date('2026-11-01T00:00:00Z'))).toBe(false);
  });

  it('reads days on the Malaysian calendar, not UTC', () => {
    expect(malaysiaDate(new Date('2026-11-10T16:30:00Z'))).toBe('2026-11-11');
    expect(malaysiaDate(new Date('2026-11-10T15:30:00Z'))).toBe('2026-11-10');
  });

  it('tells them which day was their last, and who to contact', () => {
    expect(staffLeftMessage(LAST_DAY)).toMatch(/last working day was 10 Nov 2026.*contact the office/);
  });
});
