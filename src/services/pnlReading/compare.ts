import { commonModelFor, loadCommonConfig, makeClient } from '../ai/config.js';
import { PROVIDER_IDS } from '../ai/registry.js';
import { recordAiRequest } from '../ai/usage.js';
import { AiError, type AiClient } from '../ai/types.js';
import { pdfText } from '../pdfText.js';
import { checkReading, costTotal, isCostSection, readingDifferences, readingPasses, type ReadingDifference } from '../pnlImport.logic.js';
import { READ_STATEMENT_INSTRUCTIONS, STATEMENT_JSON_SCHEMA } from './instructions.js';
import { statementDraftSchema, type StatementDraft } from './statement.js';
import { PNL_READING_FEATURE } from './index.js';

// Test site only: read one P&L with every provider that has a key, side by
// side, to see which reads your accountant's layout best. Imports nothing.
// Each reading is recorded like any other (it's real usage).

export interface ProviderResult {
  provider: string;
  model: string;
  /** The answer fitted the P&L format. */
  answered: boolean;
  /** …and passed the checks against the PDF. */
  passedChecks: boolean;
  period: StatementDraft['period'] | null;
  costLines: number;
  costTotal: number | null;
  /** Cost amounts not found printed in the PDF, plus cost sections that don't add up. */
  problems: number;
  seconds: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface Comparison { hasText: boolean; results: ProviderResult[]; differences: ReadingDifference[] }

/** Every provider with a key and a model (its default model from Settings → AI). */
async function everyProvider(): Promise<AiClient[]> {
  const common = await loadCommonConfig();
  const clients = await Promise.all(PROVIDER_IDS.map(p => makeClient(p, commonModelFor(common, p))));
  return clients.filter((c): c is AiClient => c !== null);
}

export async function compareProviders(pdf: Buffer, userId: string, clients?: AiClient[]): Promise<Comparison> {
  const readers = clients ?? await everyProvider();
  if (!readers.length) throw new AiError('No AI provider has a key yet. Add one in Settings → AI.');
  const text = await pdfText(pdf);
  const task = { instructions: READ_STATEMENT_INSTRUCTIONS, schema: { ...STATEMENT_JSON_SCHEMA }, schemaName: 'pnl_statement', pdf };

  const runs = await Promise.all(readers.map(async client => {
    const started = Date.now();
    const base = { provider: client.provider, model: client.model };
    try {
      const answer = await client.runJson(task);
      const parsed = statementDraftSchema.safeParse(answer.data);
      const draft = parsed.success ? parsed.data : null;
      const check = draft ? checkReading(draft, text) : null;
      const passedChecks = !!draft && !!check && readingPasses(draft, check);
      await recordAiRequest({ ...base, feature: PNL_READING_FEATURE, userId, ok: !!draft, passedChecks, usage: answer.usage });
      const problems = draft && check
        ? draft.sections.reduce((n, s, i) => !isCostSection(s.kind) ? n
          : n + check.sections[i].linesFound.filter(f => !f).length * (check.hasText ? 1 : 0) + (check.sections[i].addsUp === false ? 1 : 0), 0)
        : 0;
      const result: ProviderResult = {
        ...base, answered: !!draft, passedChecks, period: draft?.period ?? null,
        costLines: draft ? draft.sections.filter(s => isCostSection(s.kind)).reduce((n, s) => n + s.lines.length, 0) : 0,
        costTotal: draft ? costTotal(draft) : null, problems,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        inputTokens: answer.usage?.inputTokens ?? null, outputTokens: answer.usage?.outputTokens ?? null,
        error: draft ? null : 'The answer didn’t fit the P&L format.',
      };
      return { result, draft };
    } catch (e) {
      await recordAiRequest({ ...base, feature: PNL_READING_FEATURE, userId, ok: false, passedChecks: false, usage: null });
      const result: ProviderResult = {
        ...base, answered: false, passedChecks: false, period: null, costLines: 0, costTotal: null, problems: 0,
        seconds: Math.round((Date.now() - started) / 100) / 10, inputTokens: null, outputTokens: null,
        error: e instanceof AiError ? e.message : 'The AI had a problem.',
      };
      return { result, draft: null };
    }
  }));

  const read = runs.flatMap(r => (r.draft ? [{ reader: `${r.result.provider}:${r.result.model}`, draft: r.draft }] : []));
  return { hasText: text.trim().length > 0, results: runs.map(r => r.result), differences: readingDifferences(read) };
}
