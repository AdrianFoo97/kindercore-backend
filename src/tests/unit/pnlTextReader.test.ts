import { describe, it, expect } from 'vitest';
import { TextReadError, readStatementText } from '../../services/pnlReading/textReader.js';

// Reading a P&L without AI, from its printed text. Made-up statement in the
// shape accounting software prints (never the real ones in `test data/`).

const PAGE_HEAD = ['Current Month   Year-To-Date', 'RM   RM', '30/09/2026   30/09/2026', '%   %', 'SUNFLOWER KINDERGARTEN', 'Profit & Loss Account', 'For The Financial Year Of 2026'];
const TEXT = [
  ...PAGE_HEAD,
  'REVENUE',
  '5,000.00   50,000.00 Sales   101.00%   100.00%',
  '(   50.00)   (   90.00) Return Inwards   -1.00%   -0.20%',
  '4,950.00   49,910.00 100.00%   100.00%',
  'Gross Profit/(Loss)',
  '4,950.00',
  'LESS : EXPENDITURE',
  'Staff Cost',
  '2,000.00   20,000.00 Salaries   40.00%   40.00%',
  '200.00   2,000.00 EPF   4.00%   4.00%',
  '2,200.00   22,000.00 44.00%   44.00%',
  'Administrative Expenses',
  'Printed On 09/11/2026   Page 1',
  ...PAGE_HEAD,
  '1,116.56   6,000.00 Water & Electricity   22.00%   12.00%',
  '0.00   500.00 Toll & Parking   0.00%   1.00%',
  '1,116.56   6,500.00 22.00%   13.00%',
  'Sales and Distribution Expenses',
  '300.00   900.00 Advertisement   6.00%   2.00%',
  '300.00   900.00 6.00%   2.00%',
  'NET PROFIT/(LOSS)   1,333.44   20,510.00 26.00%   41.00%',
  'Printed On 09/11/2026   Page 2',
].join('\n');

describe('P&L import — reading without AI', () => {
  it('reads the month, each section, its lines (this month’s column) and printed subtotals', () => {
    const d = readStatementText(TEXT);
    expect(d.period).toEqual({ year: 2026, month: 9 });
    expect(d.sections.map(s => [s.title, s.kind, s.lines.length, s.printedSubtotal])).toEqual([
      ['REVENUE', 'REVENUE', 2, 4950],
      ['Staff Cost', 'EXPENSE', 2, 2200],
      ['Administrative Expenses', 'EXPENSE', 2, 1116.56],
      ['Sales and Distribution Expenses', 'EXPENSE', 1, 300],
    ]);
    expect(d.sections[0].lines).toEqual([{ name: 'Sales', amount: 5000 }, { name: 'Return Inwards', amount: -50 }]);
    expect(d.sections[2].lines[0]).toEqual({ name: 'Water & Electricity', amount: 1116.56 });
  });

  it('carries a section across a page break and ignores page headers, footers and profit rows', () => {
    const d = readStatementText(TEXT);
    const names = d.sections.flatMap(s => s.lines.map(l => l.name));
    expect(names).not.toContain('NET PROFIT/(LOSS)');
    expect(names.some(n => /printed on|sunflower/i.test(n))).toBe(false);
  });

  it('takes the second column when Year-To-Date is printed before Current Month', () => {
    const swapped = TEXT.replace('Current Month   Year-To-Date', 'Year-To-Date   Current Month');
    expect(readStatementText(swapped).sections[1].lines[0]).toEqual({ name: 'Salaries', amount: 20000 });
  });

  it('says plainly when it can’t: no text (scanned), no month, or no items', () => {
    expect(() => readStatementText('')).toThrow(TextReadError);
    expect(() => readStatementText('REVENUE\nSales 100.00')).toThrow('which month');
    expect(() => readStatementText('Current Month 30/09/2026\nREVENUE')).toThrow('line items');
  });
});
