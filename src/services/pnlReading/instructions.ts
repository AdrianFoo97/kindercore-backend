import { SECTION_KINDS } from './statement.js';

// What the AI is asked to do when reading a P&L, whichever provider runs it.
// Bump the version whenever the wording changes — each import records it.

export const INSTRUCTIONS_VERSION = 1;

export const READ_STATEMENT_INSTRUCTIONS = `You are reading a company's Profit & Loss statement (PDF) so its figures can be entered into an accounting system. Copy exactly what is printed — never estimate, round, or invent a figure.

Return:
- period: the year and month (1-12) of the "current month" column — usually printed as a date such as 30/09/2026.
- sections: every block of line items that ends with a printed subtotal, in the order printed. For each:
  - title: the heading printed above that block (e.g. "Administrative Expenses", "Staff Cost", "Revenue"). Use the most specific heading.
  - kind: REVENUE (sales and returns), COST_OF_SALES (cost of goods sold / purchases), OTHER_INCOME (other revenue or income), or EXPENSE (any expenditure).
  - lines: each line item with its name exactly as printed and its CURRENT MONTH amount only. Ignore year-to-date, percentage and any other columns. Amounts in brackets, e.g. "( 1,170.00)", are negative. Include lines whose amount is 0.00. Do not include subtotal, total, gross profit, net profit or retained profit rows as lines.
  - printedSubtotal: the current-month subtotal printed under that block, or null if none is printed.

Amounts are plain numbers without currency or thousands separators (1,116.56 becomes 1116.56).`;

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

/** The answer format, as a JSON schema — mirrors `statementDraftSchema` (statement.ts), which has the final say. */
export const STATEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'sections'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['year', 'month'],
      properties: { year: { type: 'integer' }, month: { type: 'integer' } },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'lines', 'printedSubtotal'],
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: [...SECTION_KINDS] },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'amount'],
              properties: { name: { type: 'string' }, amount: { type: 'number' } },
            },
          },
          printedSubtotal: nullableNumber,
        },
      },
    },
  },
} as const;
