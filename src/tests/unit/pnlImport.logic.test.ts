import { describe, it, expect } from 'vitest';
import {
  amountsInText, checkReading, costTotal, editDistance, matchLine, normaliseLineName, planImport, previewLines, readingDifferences,
  type CategoryRef, type ImportRule,
} from '../../services/pnlImport.logic.js';
import type { StatementDraft } from '../../services/pnlReading/index.js';

// A made-up P&L (never the real ones in `test data/`).
const DRAFT: StatementDraft = {
  period: { year: 2026, month: 9 },
  sections: [
    { title: 'Revenue', kind: 'REVENUE', printedSubtotal: 5000, lines: [{ name: 'Sales', amount: 5000 }] },
    { title: 'Administrative Expenses', kind: 'EXPENSE', printedSubtotal: 1416.56, lines: [
      { name: 'Rental', amount: 300 },
      { name: 'Water & Electricity', amount: 1116.56 },
      { name: 'Toll & Parking', amount: 0 },
    ] },
    { title: 'Staff Cost', kind: 'EXPENSE', printedSubtotal: 2600, lines: [
      { name: 'Salaries', amount: 2500 },
      { name: 'Fire Extinguisher', amount: 100 },
    ] },
  ],
};
const PDF_TEXT = 'Sales 5,000.00 Rental 300.00 Water & Electricity 1,116.56 Toll 0.00 1,416.56 Salaries 2,500.00 Fire Extinguisher 100.00 2,600.00';

const CATS: CategoryRef[] = [
  { id: 'c-rent', name: 'Rental', groupId: 'g-admin', groupName: 'Administrative' },
  { id: 'c-water', name: 'Water & Electricty', groupId: 'g-admin', groupName: 'Administrative' }, // the system's typo
  { id: 'c-toll', name: 'Toll & Parking', groupId: 'g-admin', groupName: 'Administrative' },
];
const RULES = new Map<string, ImportRule>([['salaries', { lineKey: 'salaries', action: 'SKIP', categoryId: null }]]);

describe('P&L import — reading checks and matching', () => {
  it('treats case, spacing and “&” vs “and” as the same name', () => {
    expect(normaliseLineName('Waste  Collection')).toBe(normaliseLineName('waste collection'));
    expect(normaliseLineName('Tel, Fax, H/P and Internet')).toBe(normaliseLineName('Tel Fax H P & Internet'));
  });

  it('finds every amount printed in the PDF, with or without thousands commas', () => {
    const found = amountsInText('Rental 4,200.00 ( 1,170.00) Fee 63.41');
    expect([...found].sort()).toEqual(['1170.00', '4200.00', '63.41']);
  });

  it('proves each amount is printed in the file and each section adds up to its printed subtotal', () => {
    const check = checkReading(DRAFT, PDF_TEXT);
    expect(check.hasText).toBe(true);
    expect(check.sections[1]).toMatchObject({ sum: 1416.56, addsUp: true, linesFound: [true, true, true] });
  });

  it('flags an amount that isn’t in the file and a section that doesn’t add up', () => {
    const misread: StatementDraft = { ...DRAFT, sections: [{ ...DRAFT.sections[1], lines: [{ name: 'Rental', amount: 3000 }, ...DRAFT.sections[1].lines.slice(1)] }] };
    const check = checkReading(misread, PDF_TEXT);
    expect(check.sections[0].linesFound[0]).toBe(false);
    expect(check.sections[0].addsUp).toBe(false);
  });

  it('marks a scanned PDF (no text) so every amount is checked by eye', () => {
    const check = checkReading(DRAFT, '');
    expect(check.hasText).toBe(false);
    expect(check.sections.flatMap(s => s.linesFound).every(f => f === false)).toBe(true);
  });

  it('matches exact names, suggests close spellings, follows rules, and leaves the rest as new', () => {
    expect(matchLine('Rental', CATS, RULES)).toEqual({ status: 'MATCHED', categoryId: 'c-rent' });
    expect(matchLine('Water & Electricity', CATS, RULES)).toEqual({ status: 'SUGGESTED', categoryId: 'c-water' });
    expect(matchLine('Salaries', CATS, RULES)).toEqual({ status: 'SKIP_RULE', categoryId: null });
    expect(matchLine('Fire Extinguisher', CATS, RULES)).toEqual({ status: 'NEW', categoryId: null });
    const remembered = new Map<string, ImportRule>([['fire extinguisher', { lineKey: 'fire extinguisher', action: 'RECORD', categoryId: 'c-toll' }]]);
    expect(matchLine('Fire Extinguisher', CATS, remembered)).toEqual({ status: 'MATCHED', categoryId: 'c-toll' });
    expect(editDistance('electricity', 'electricty')).toBe(1);
  });

  it('never imports revenue, and sets aside nothing-spent lines', () => {
    const lines = previewLines(DRAFT, checkReading(DRAFT, PDF_TEXT), CATS, RULES);
    expect(lines.find(l => l.name === 'Sales')?.status).toBe('NOT_A_COST');
    expect(lines.find(l => l.name === 'Toll & Parking')?.status).toBe('ZERO');
    expect(lines.map(l => l.key)).toEqual(['0-0', '1-0', '1-1', '1-2', '2-0', '2-1']);
  });
});

describe('P&L import — what an import writes', () => {
  const line = (name: string, amount: number, extra: object = {}) => ({ name, section: 'Admin', amount, action: 'RECORD' as const, categoryId: 'c-rent', ...extra });

  it('adds lines going into the same category together', () => {
    const plan = planImport([line('Rental', 300), line('Rental - store', 50.5)], new Map());
    expect(plan.writes).toEqual([{ categoryId: 'c-rent', amount: 350.5 }]);
  });

  it('keeps an amount already entered unless the line says replace — and lists it as not imported', () => {
    const existing = new Map([['c-rent', 280]]);
    const kept = planImport([line('Rental', 300)], existing);
    expect(kept.writes).toEqual([]);
    expect(kept.notImported).toEqual([{ name: 'Rental', section: 'Admin', amount: 300, reason: 'Kept the RM 280.00 already entered' }]);
    expect(planImport([line('Rental', 300, { replace: true })], existing).writes).toEqual([{ categoryId: 'c-rent', amount: 300 }]);
    expect(planImport([line('Rental', 280)], existing).writes).toEqual([{ categoryId: 'c-rent', amount: 280 }]);
  });

  it('lists skipped lines with why, and saves remembered choices as rules', () => {
    const plan = planImport([
      { name: 'Salaries', section: 'Staff Cost', amount: 2500, action: 'SKIP', categoryId: null, byRule: true },
      { name: 'Fire Extinguisher', section: 'Admin', amount: 100, action: 'SKIP', categoryId: null, remember: true },
    ], new Map());
    expect(plan.notImported.map(n => n.reason)).toEqual(['Skipped by an import rule', 'Skipped']);
    expect(plan.rules).toEqual([{ lineKey: 'fire extinguisher', lineName: 'Fire Extinguisher', action: 'SKIP', categoryId: null }]);
  });
});

describe('P&L import — comparing providers', () => {
  it('totals only the cost sections', () => {
    expect(costTotal(DRAFT)).toBe(4016.56);
  });

  it('lists the cost lines readers disagree on — a different amount, or a line only some found', () => {
    const misread: StatementDraft = { ...DRAFT, sections: DRAFT.sections.map(s => s.title !== 'Staff Cost' ? s
      : { ...s, lines: [{ name: 'Salaries', amount: 2500 }, { name: 'Fire Extinguisher', amount: 1000 }] }) };
    const noFire: StatementDraft = { ...DRAFT, sections: DRAFT.sections.map(s => s.title !== 'Staff Cost' ? s : { ...s, lines: [{ name: 'Salaries', amount: 2500 }] }) };
    expect(readingDifferences([{ reader: 'a', draft: DRAFT }, { reader: 'b', draft: misread }, { reader: 'c', draft: noFire }]))
      .toEqual([{ name: 'Fire Extinguisher', amounts: { a: 100, b: 1000, c: null } }]);
    expect(readingDifferences([{ reader: 'a', draft: DRAFT }, { reader: 'b', draft: DRAFT }])).toEqual([]);
  });
});
