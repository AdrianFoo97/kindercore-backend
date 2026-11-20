import { z } from 'zod';

// P&L reading — the one shape the AI's answer must have, whichever provider
// read it. An answer that doesn't fit is refused. Amounts are this month's
// only, in RM — brackets on the statement become negative numbers.

/** What a section of the statement is — only cost sections can be recorded as operating costs. */
export const SECTION_KINDS = ['REVENUE', 'COST_OF_SALES', 'OTHER_INCOME', 'EXPENSE'] as const;
export type SectionKind = typeof SECTION_KINDS[number];

/** Limits that keep a malformed answer from turning into something huge. */
export const MAX_SECTIONS = 50;
export const MAX_LINES_PER_SECTION = 200;

export const statementLineSchema = z.object({
  name: z.string().trim().min(1).max(191),
  amount: z.number().finite(),
});

export const statementSectionSchema = z.object({
  title: z.string().trim().min(1).max(191),
  kind: z.enum(SECTION_KINDS),
  lines: z.array(statementLineSchema).max(MAX_LINES_PER_SECTION),
  printedSubtotal: z.number().finite().nullable(),
});

export const statementDraftSchema = z.object({
  period: z.object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
  }),
  sections: z.array(statementSectionSchema).min(1).max(MAX_SECTIONS),
});

export type StatementLine = z.infer<typeof statementLineSchema>;
export type StatementSection = z.infer<typeof statementSectionSchema>;
export type StatementDraft = z.infer<typeof statementDraftSchema>;
