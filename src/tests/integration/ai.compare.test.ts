import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { aiRequests } from '../../db/schema.js';
import { compareProviders } from '../../services/pnlReading/compare.js';
import { providerStats } from '../../services/ai/usage.js';
import { AiError, type AiClient } from '../../services/ai/types.js';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';
import { makePdf, SAMPLE_PNL_LINES, SAMPLE_PNL_READING } from '../fixtures/pnlPdf.js';
import { resetTables } from './testDb.js';

// Test site → compare providers on one made-up P&L, and the per-provider
// record Settings → AI shows. Fake clients — no real AI is called.

const PDF = makePdf(SAMPLE_PNL_LINES);
const MISREAD = {
  ...SAMPLE_PNL_READING,
  sections: SAMPLE_PNL_READING.sections.map(s => s.title !== 'Administrative Expenses' ? s
    : { ...s, lines: s.lines.map(l => (l.name === 'Rental' ? { ...l, amount: 4000 } : l)) }),
};
const fake = (provider: string, answer: unknown | Error): AiClient => ({
  provider, model: `${provider}-1`,
  runJson: async () => { if (answer instanceof Error) throw answer; return { data: answer, usage: { inputTokens: 1000, outputTokens: 200 } }; },
});

beforeEach(async () => { await resetTables(aiRequests); });
afterAll(async () => { await pool.end(); });

describe('AI — comparing providers on one P&L (test site)', () => {
  it('reads the same P&L with every provider, shows how each did, and lists the lines they read differently', async () => {
    const c = await compareProviders(PDF, 'u-admin', [fake('anthropic', SAMPLE_PNL_READING), fake('openai', MISREAD), fake('other', new AiError('The AI is busy.'))]);
    expect(c.hasText).toBe(true);
    expect(c.results.map(r => [r.provider, r.answered, r.passedChecks, r.costTotal, r.problems, r.error])).toEqual([
      ['anthropic', true, true, 8449.86, 0, null],
      ['openai', true, false, 8249.86, 2, null],
      ['other', false, false, null, 0, 'The AI is busy.'],
    ]);
    expect(c.differences).toEqual([{ name: 'Rental', amounts: { 'anthropic:anthropic-1': 4200, 'openai:openai-1': 4000 } }]);
  });

  it('records each comparison reading, so Settings → AI shows how each provider did this month', async () => {
    await compareProviders(PDF, 'u-admin', [fake('anthropic', SAMPLE_PNL_READING), fake('openai', MISREAD)]);
    const stats = await providerStats();
    expect(stats.map(s => [s.feature, s.provider, s.requests, s.answered, s.passed, s.inputTokens]).sort()).toEqual([
      ['pnl-reading', 'anthropic', 1, 1, 1, 1000],
      ['pnl-reading', 'openai', 1, 1, 0, 1000],
    ]);
  });

  it('is only on the test site, and only for admins', () => {
    const route = ARCHITECTURE.routeGroups.flatMap(g => g.endpoints).find(e => e.method === 'POST' && e.path === '/api/ai/compare/pnl-reading');
    expect(route?.middleware).toEqual(expect.arrayContaining(['authMiddleware', 'adminMiddleware', 'testEnvOnly']));
  });
});
