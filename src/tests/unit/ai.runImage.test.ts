import { describe, it, expect } from 'vitest';
import { runAiImage, NO_DRAWER_MESSAGE, type AiLedger, type AiSetup } from '../../services/ai/run.js';
import { AiError, type AiClient } from '../../services/ai/types.js';
import type { AiRequestRecord } from '../../services/ai/usage.js';

// The AI layer drawing a picture: it uses the first provider that can draw,
// falls back to the next when one fails, keeps the monthly limit, and
// records every request.

const TASK = { prompt: 'A poster', orientation: 'portrait' as const };
const writer = (provider: string): AiClient => ({ provider, model: 'text-1', runJson: async () => ({ data: null, usage: null }) });
const drawer = (provider: string, fail = false): AiClient => ({
  ...writer(provider),
  makeImage: async () => { if (fail) throw new AiError('busy'); return { data: Buffer.from('img'), mimeType: 'image/jpeg', usage: null, model: 'image-1' }; },
});
function ledger(used = 0): AiLedger & { records: AiRequestRecord[] } {
  const records: AiRequestRecord[] = [];
  return { records, record: async r => { records.push(r); }, countThisMonth: async () => used };
}
const setup = (primary: AiClient | null, backup: AiClient | null = null, monthlyLimit: number | null = null): AiSetup => ({ enabled: true, primary, backup, monthlyLimit });

describe('AI layer — drawing a picture', () => {
  it('skips a provider that can’t draw (Claude) and draws with the backup — recording the image model used', async () => {
    const l = ledger();
    const run = await runAiImage('guide-poster', TASK, { userId: 'u1' }, setup(writer('anthropic'), drawer('openai')), l);
    expect(run).toMatchObject({ provider: 'openai', model: 'image-1', mimeType: 'image/jpeg' });
    expect(l.records).toEqual([expect.objectContaining({ provider: 'openai', model: 'image-1', ok: true })]);
  });

  it('tries the backup when the main drawer fails, and says so plainly when nothing can draw', async () => {
    const l = ledger();
    const run = await runAiImage('guide-poster', TASK, { userId: 'u1' }, setup(drawer('openai', true), drawer('openai-2')), l);
    expect(run.provider).toBe('openai-2');
    expect(l.records.map(r => r.ok)).toEqual([false, true]);
    await expect(runAiImage('guide-poster', TASK, { userId: 'u1' }, setup(writer('anthropic')), ledger())).rejects.toThrow(NO_DRAWER_MESSAGE);
  });

  it('keeps the monthly limit, and refuses when the feature is switched off', async () => {
    await expect(runAiImage('guide-poster', TASK, { userId: 'u1' }, setup(drawer('openai'), null, 5), ledger(5))).rejects.toThrow(/limit of 5/);
    await expect(runAiImage('guide-poster', TASK, { userId: 'u1' }, { ...setup(drawer('openai')), enabled: false }, ledger())).rejects.toThrow(/switched off/);
  });
});
