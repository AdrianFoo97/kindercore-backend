import { runAiTask, type AiLedger, type AiSetup } from '../ai/run.js';
import { INSTRUCTIONS_VERSION, READ_STATEMENT_INSTRUCTIONS, STATEMENT_JSON_SCHEMA } from './instructions.js';
import { statementDraftSchema, type StatementDraft } from './statement.js';

// The "Read P&L statements" AI feature (Settings → AI → Finance). Supplies
// only what's P&L-specific — the instructions, the answer's shape and the
// checks; the AI layer picks the provider, applies the backup and limit, and
// records the request.

export type { StatementDraft, StatementSection, StatementLine, SectionKind } from './statement.js';
export { AiError as StatementReadError } from '../ai/types.js';

export const PNL_READING_FEATURE = 'pnl-reading' as const;

export interface StatementReading {
  draft: StatementDraft;
  provider: string;
  model: string;
  instructionsVersion: number;
  /** Why the backup provider read it (null = the main one did). */
  backupReason: string | null;
}

export interface ReadOptions {
  userId: string;
  /** Whether a reading passes the checks against the PDF — a failing one is retried with the backup. */
  passes?: (draft: StatementDraft) => boolean;
}

export async function readStatement(pdf: Buffer, opts: ReadOptions, setup?: AiSetup, ledger?: AiLedger): Promise<StatementReading> {
  const run = await runAiTask(PNL_READING_FEATURE, {
    instructions: READ_STATEMENT_INSTRUCTIONS, schema: { ...STATEMENT_JSON_SCHEMA }, schemaName: 'pnl_statement', pdf,
  }, {
    userId: opts.userId,
    parse: data => { const p = statementDraftSchema.safeParse(data); return p.success ? p.data : null; },
    passes: opts.passes,
    incompleteMessage: 'The AI’s reading of the P&L was incomplete. Try again.',
  }, setup, ledger);
  return { draft: run.result, provider: run.provider, model: run.model, instructionsVersion: INSTRUCTIONS_VERSION, backupReason: run.backupReason };
}
