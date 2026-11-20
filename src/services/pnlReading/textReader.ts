import type { SectionKind, StatementDraft, StatementSection } from './statement.js';

// Reading a P&L WITHOUT AI — from the PDF's own printed text. Used when the
// AI can't be reached (or isn't set up) and the person chooses to carry on.
// It understands the usual printed shape of a P&L:
//   - a heading line (no amounts) starts a section ("Administrative Expenses")
//   - a line with a name and amounts is an item; its first amount is this
//     month (or the second, if "Year-To-Date" is printed before "Current Month")
//   - a line with amounts but no name is the section's subtotal
//   - total / profit rows, page headers and footers are ignored
// Its answer then goes through exactly the same checks as an AI's, and a
// person still decides every line — it's a reader, not a decider.

/** An amount as printed: 1,116.56 or (1,170.00) — brackets mean negative. */
const MONEY = /\(\s*-?[\d,]*\d\.\d{2}\s*\)|-?[\d,]*\d\.\d{2}(?!\s*%)/g;
const PERCENT = /-?[\d,]*\d(\.\d+)?\s*%/g;
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
/** Rows that are totals of totals, not items (and not sections). */
const TOTAL_ROW = /\b(total|profit|loss|retained|balance|b\/f|c\/f)\b/i;
/** Page furniture repeated on every page. */
const NOISE = /printed on|\bpage \d|current month|year-to-date|financial year|profit\s*&\s*loss account|^\s*(rm|%)(\s+(rm|%))*\s*$/i;

function toAmount(token: string): number {
  const negative = token.includes('(') || token.trim().startsWith('-');
  const n = Number(token.replace(/[()\s,-]/g, ''));
  return negative ? -n : n;
}

/** What a heading says about the money below it. */
function kindOf(heading: string): SectionKind | null {
  const h = heading.toLowerCase();
  if (/cost of (goods|sales)|purchases/.test(h)) return 'COST_OF_SALES';
  if (/other (revenue|income)/.test(h)) return 'OTHER_INCOME';
  // Expenses before revenue: "Sales and Distribution Expenses" is an expense.
  if (/expen|overhead/.test(h)) return 'EXPENSE';
  if (/revenue|turnover|^\s*income|^\s*sales\b/.test(h)) return 'REVENUE';
  if (/\bcosts?\b/.test(h)) return 'EXPENSE';
  return null;
}

export class TextReadError extends Error {}

/** Reads a P&L from its printed text. Throws TextReadError when it can't (no text, no month, no items). */
export function readStatementText(text: string): StatementDraft {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.length) throw new TextReadError('This PDF has no readable text (it may be scanned), so it can’t be read without AI.');

  // Which money column is "this month": the first unless Year-To-Date is printed before it.
  const header = lines.find(l => /current month/i.test(l) && /year-to-date/i.test(l)) ?? '';
  const column = header && header.toLowerCase().indexOf('year-to-date') < header.toLowerCase().indexOf('current month') ? 1 : 0;

  const dateLine = lines.find(l => DATE.test(l));
  const date = dateLine?.match(DATE);
  if (!date) throw new TextReadError('Couldn’t find which month this P&L is for.');
  const period = { year: Number(date[3]), month: Number(date[2]) };

  // Lines printed on every page (e.g. the company name) are page headers.
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);

  const sections: StatementSection[] = [];
  /** The section being filled, the kind its group heading set, and the heading waiting for items. */
  const at: { open: StatementSection | null; group: SectionKind | null; title: string | null } = { open: null, group: null, title: null };

  for (const line of lines) {
    const amounts = [...line.matchAll(MONEY)].map(m => toAmount(m[0]));
    if (NOISE.test(line) || (seen.get(line)! > 1 && !amounts.length)) continue;
    const name = line.replace(MONEY, ' ').replace(PERCENT, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const hasName = /[a-z]{2,}/i.test(name);

    if (hasName && TOTAL_ROW.test(name)) { at.open = null; at.title = null; continue; }

    if (!amounts.length) {
      if (!hasName) continue;
      // A heading: a group ("LESS : EXPENDITURE") sets the kind; the most specific heading names the section.
      const title = name.replace(/^less\s*:\s*/i, '').trim();
      const k = kindOf(title);
      if (k) at.group = k;
      at.title = title;
      at.open = null;
      continue;
    }

    const amount = amounts[Math.min(column, amounts.length - 1)];
    if (!hasName) {
      // A subtotal closes the section it follows; stray numbers (e.g. under "Gross Profit") are ignored.
      if (at.open) { at.open.printedSubtotal = amount; at.open = null; }
      continue;
    }
    if (!at.open) {
      const title = at.title ?? 'Other';
      at.open = { title, kind: kindOf(title) ?? at.group ?? 'EXPENSE', lines: [], printedSubtotal: null };
      sections.push(at.open);
    }
    at.open.lines.push({ name, amount });
  }

  const kept = sections.filter(s => s.lines.length > 0);
  if (!kept.length) throw new TextReadError('Couldn’t find any line items in this P&L’s text.');
  return { period, sections: kept };
}
