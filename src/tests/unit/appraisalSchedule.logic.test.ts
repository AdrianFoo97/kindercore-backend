import { describe, it, expect } from 'vitest';
import { dueToday, malaysiaToday, nextDue, periodFor, periodKey, ruleProblem, type ScheduleRule } from '../../services/appraisalSchedule.logic.js';

// Appraisal schedules: when each one creates the next appraisal, and which
// period that appraisal covers.

const rule = (over: Partial<ScheduleRule>): ScheduleRule =>
  ({ repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15', lastPeriodKey: null, ...over });
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { year: y, month: m - 1, day: d }; };

describe('Appraisal schedules — when one is due', () => {
  it('creates a monthly one on its day each month, from the start date on — not for a month that began before it', () => {
    const r = rule({});
    expect(dueToday(r, day('2026-11-20'))).toBeNull(); // the 1st of Nov was before it started
    expect(dueToday(r, day('2026-12-01'))).toMatchObject({ period: { year: 2026, month: 11 } });
    // Missed the day (server off)? It still makes it later that month.
    expect(dueToday(r, day('2026-12-09'))).toMatchObject({ period: { year: 2026, month: 11 } });
    expect(dueToday(rule({ dayOfMonth: 10 }), day('2026-12-09'))).toBeNull();
  });

  it('never makes the same period twice — even if that appraisal was cancelled', () => {
    const made = rule({ lastPeriodKey: periodKey({ year: 2026, month: 11 }) });
    expect(dueToday(made, day('2026-12-20'))).toBeNull();
    expect(dueToday(made, day('2027-01-01'))).toMatchObject({ period: { year: 2027, month: 0 } });
  });

  it('covers a quarter or a year, and a yearly one waits for its month', () => {
    expect(periodFor('QUARTERLY', 2027, 4)).toEqual({ year: 2027, month: 3 });
    expect(dueToday(rule({ repeat: 'QUARTERLY' }), day('2027-01-02'))).toMatchObject({ period: { year: 2027, month: 0 } });
    const yearly = rule({ repeat: 'YEARLY', monthOfYear: 5, dayOfMonth: 15 });
    expect(dueToday(yearly, day('2027-06-14'))).toBeNull();
    expect(dueToday(yearly, day('2027-06-15'))).toMatchObject({ period: { year: 2027, month: 0 } });
  });

  it('makes a one-off once, on its date', () => {
    const once = rule({ repeat: 'ONCE', startsOn: '2026-12-03' });
    expect(dueToday(once, day('2026-12-02'))).toBeNull();
    expect(dueToday(once, day('2026-12-05'))).toMatchObject({ period: { year: 2026, month: 11 } });
    expect(dueToday({ ...once, lastPeriodKey: periodKey({ year: 2026, month: 11 }) }, day('2026-12-05'))).toBeNull();
  });
});

describe('Appraisal schedules — what the page shows', () => {
  it('says when the next one will be made, or that there are no more', () => {
    expect(nextDue(rule({}), day('2026-11-20'))).toEqual(day('2026-12-01'));
    expect(nextDue(rule({ repeat: 'QUARTERLY', dayOfMonth: 5 }), day('2026-11-20'))).toEqual(day('2027-01-05'));
    expect(nextDue(rule({ repeat: 'YEARLY', monthOfYear: 0 }), day('2026-11-20'))).toEqual(day('2027-01-01'));
    expect(nextDue(rule({ repeat: 'ONCE', startsOn: '2026-12-03', lastPeriodKey: 1 }), day('2026-11-20'))).toBeNull();
    expect(malaysiaToday(new Date('2026-11-30T17:00:00Z'))).toEqual(day('2026-12-01')); // 1am on the 1st in Malaysia
  });

  it('checks the rule in plain words', () => {
    expect(ruleProblem({ repeat: 'MONTHLY', dayOfMonth: 31, monthOfYear: null, startsOn: '2026-11-15' })).toBe('Pick a day from 1 to 28.');
    expect(ruleProblem({ repeat: 'YEARLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15' })).toBe('Pick the month.');
    expect(ruleProblem({ repeat: 'ONCE', dayOfMonth: 0, monthOfYear: null, startsOn: 'soon' })).toBe('Pick a start date.');
    expect(ruleProblem({ repeat: 'MONTHLY', dayOfMonth: 1, monthOfYear: null, startsOn: '2026-11-15' })).toBeNull();
  });
});
