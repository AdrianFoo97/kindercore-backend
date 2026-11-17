import { describe, it, expect } from 'vitest';
import { averageOverWindow, currentMalaysiaMonth, isInAverageWindow, periodAverages, previousAppraisal, quarterAverages } from '../../services/appraisal.service.js';

// The appraisal average shown on the staff record, HR → Appraisals and the
// teacher's own page — and used for the "average > 75%" promotion gate.
// Months are 0–11 (0 = January).

const NOV_2026 = { year: 2026, month: 10 };

describe('Appraisals — 12-month average', () => {
  it('covers the 12 months up to and including this month', () => {
    expect(isInAverageWindow({ year: 2026, month: 10 }, NOV_2026)).toBe(true);  // Nov 2026
    expect(isInAverageWindow({ year: 2025, month: 11 }, NOV_2026)).toBe(true);  // Dec 2025 — 12th month back
    expect(isInAverageWindow({ year: 2025, month: 10 }, NOV_2026)).toBe(false); // Nov 2025 — 13 months back
    expect(isInAverageWindow({ year: 2026, month: 11 }, NOV_2026)).toBe(false); // a future month
  });

  it('averages only the months that were appraised, ignoring older scores', () => {
    const rows = [
      { year: 2026, month: 10, score: 80 },
      { year: 2026, month: 3, score: 70 },
      { year: 2025, month: 0, score: 10 }, // Jan 2025 — too old, must not drag the average down
    ];
    expect(averageOverWindow(rows, NOV_2026)).toEqual({ average: 75, recordCount: 2, windowSize: 12 });
  });

  it('crosses the new year rather than restarting each January', () => {
    const rows = [{ year: 2025, month: 11, score: 90 }, { year: 2026, month: 0, score: 70 }];
    expect(averageOverWindow(rows, { year: 2026, month: 0 }).average).toBe(80);
  });

  it('has no average when nothing was appraised in the last 12 months', () => {
    expect(averageOverWindow([{ year: 2024, month: 5, score: 90 }], NOV_2026)).toEqual({ average: null, recordCount: 0, windowSize: 12 });
  });

  it('finds the previous mark — the latest appraisal before the month being recorded', () => {
    const rows = [
      { year: 2026, month: 10, score: 90 }, // the month itself — not "previous"
      { year: 2026, month: 7, score: 72 },
      { year: 2025, month: 11, score: 60 },
    ];
    expect(previousAppraisal(rows, NOV_2026)).toMatchObject({ year: 2026, month: 7, score: 72 });
    expect(previousAppraisal(rows, { year: 2025, month: 11 })).toBeNull();
  });

  it('averages this quarter and this year so far, up to the month shown', () => {
    const rows = [{ year: 2026, month: 9, score: 80 }, { year: 2026, month: 10, score: 90 }, { year: 2026, month: 11, score: 50 }, { year: 2026, month: 2, score: 60 }, { year: 2025, month: 11, score: 10 }];
    // November: Q4 so far = Oct + Nov = 85; the year so far = Mar, Oct, Nov = 77 (December and last year don't count).
    expect(periodAverages(rows, { year: 2026, month: 10 })).toEqual({ quarter: 85, year: 77 });
    expect(periodAverages(rows, { year: 2026, month: 0 })).toEqual({ quarter: null, year: null });
  });

  it('uses the Malaysian calendar month, so the 1st at 7am is already the new month', () => {
    expect(currentMalaysiaMonth(new Date('2026-10-31T23:30:00Z'))).toEqual({ year: 2026, month: 10 }); // 1 Nov, 7:30am MYT
  });

  it('averages each quarter that has appraisals, newest first, for the history grouped by quarter', () => {
    const scores = [
      { year: 2026, month: 9, score: 80 }, { year: 2026, month: 10, score: 70 }, // Q4 → 75
      { year: 2026, month: 1, score: 61 },                                      // Q1 → 61
      { year: 2025, month: 11, score: 90 },                                     // 2025 Q4 → 90
    ];
    expect(quarterAverages(scores)).toEqual([
      { year: 2026, quarter: 4, average: 75 }, { year: 2026, quarter: 1, average: 61 }, { year: 2025, quarter: 4, average: 90 },
    ]);
  });
});
