import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { runAiTask, type AiLedger, type AiSetup } from '../../services/ai/run.js';
import { anthropicClient, listAnthropicModels, type AnthropicMessagesClient } from '../../services/ai/anthropic.js';
import { listOpenAIModels, openaiClient, type OpenAIResponsesClient } from '../../services/ai/openai.js';
import { effectiveChoice, makeClient, type CommonAiConfig } from '../../services/ai/config.js';
import { AiError, type AiClient, type AiJsonTask } from '../../services/ai/types.js';
import type { AiRequestRecord } from '../../services/ai/usage.js';

// The AI layer every feature shares — runner, settings resolution and the
// provider adapters — without calling any real AI service.

const TASK: AiJsonTask = { instructions: 'Read it', schema: { type: 'object' }, schemaName: 'thing', pdf: Buffer.from('%PDF') };
const USAGE = { inputTokens: 1200, outputTokens: 300 };
const GOOD = { total: 300 };
const WRONG = { total: 3000 };

const fake = (provider: string, answer: unknown | Error): AiClient => ({
  provider, model: `${provider}-1`,
  runJson: async () => { if (answer instanceof Error) throw answer; return { data: answer, usage: USAGE }; },
});
const opts = {
  userId: 'u1',
  parse: (d: unknown) => (d && typeof (d as { total?: unknown }).total === 'number' ? d as { total: number } : null),
  passes: (r: { total: number }) => r.total === 300,
};
function memoryLedger(used: Record<string, number> = {}) {
  const records: AiRequestRecord[] = [];
  const ledger: AiLedger = { record: async r => { records.push(r); }, countThisMonth: async p => used[p] ?? 0 };
  return { ledger, records };
}
const setup = (primary: AiClient | null, backup: AiClient | null = null, monthlyLimit: number | null = null, enabled = true): AiSetup => ({ enabled, primary, backup, monthlyLimit });

describe('AI layer — running a feature’s task', () => {
  it('answers with the feature’s provider, recording the request against the feature', async () => {
    const { ledger, records } = memoryLedger();
    const r = await runAiTask('pnl-reading', TASK, opts, setup(fake('a', GOOD)), ledger);
    expect(r).toEqual({ result: GOOD, provider: 'a', model: 'a-1', backupReason: null });
    expect(records).toEqual([{ feature: 'pnl-reading', provider: 'a', model: 'a-1', userId: 'u1', ok: true, passedChecks: true, usage: USAGE }]);
  });

  it('refuses when the feature is switched off or no provider is set up', async () => {
    const { ledger } = memoryLedger();
    await expect(runAiTask('pnl-reading', TASK, opts, setup(fake('a', GOOD), null, null, false), ledger)).rejects.toThrow('switched off');
    await expect(runAiTask('pnl-reading', TASK, opts, setup(null), ledger)).rejects.toThrow('No AI provider');
  });

  it('refuses an answer that doesn’t fit the feature’s format', async () => {
    const { ledger, records } = memoryLedger();
    await expect(runAiTask('pnl-reading', TASK, opts, setup(fake('a', { nope: 1 })), ledger)).rejects.toBeInstanceOf(AiError);
    expect(records[0]).toMatchObject({ ok: false, passedChecks: false });
  });

  it('asks the backup when the main provider fails, and says why', async () => {
    const { ledger, records } = memoryLedger();
    const r = await runAiTask('pnl-reading', TASK, opts, setup(fake('anthropic', new AiError('The AI is busy.')), fake('openai', GOOD)), ledger);
    expect(r).toMatchObject({ provider: 'openai', backupReason: 'Anthropic (Claude) couldn’t do it (The AI is busy.)' });
    expect(records.map(x => [x.provider, x.ok])).toEqual([['anthropic', false], ['openai', true]]);
  });

  it('asks the backup when the answer fails the feature’s checks — keeping the main one if the backup is no better', async () => {
    const { ledger } = memoryLedger();
    expect(await runAiTask('pnl-reading', TASK, opts, setup(fake('anthropic', WRONG), fake('openai', GOOD)), ledger))
      .toMatchObject({ provider: 'openai', backupReason: 'Anthropic (Claude)’s answer didn’t pass the checks' });
    expect(await runAiTask('pnl-reading', TASK, opts, setup(fake('anthropic', WRONG), fake('openai', WRONG)), ledger))
      .toMatchObject({ provider: 'anthropic', backupReason: null });
  });

  it('stops at the monthly limit, moving on to the backup if it has room', async () => {
    const full = memoryLedger({ anthropic: 20 });
    await expect(runAiTask('pnl-reading', TASK, opts, setup(fake('anthropic', GOOD), null, 20), full.ledger)).rejects.toThrow('limit of 20 AI requests');
    expect((await runAiTask('pnl-reading', TASK, opts, setup(fake('anthropic', GOOD), fake('openai', GOOD), 20), full.ledger)).provider).toBe('openai');
  });
});

describe('AI layer — common settings and each feature’s own', () => {
  const common: CommonAiConfig = { provider: 'anthropic', backup: 'openai', models: { openai: 'oa-model' }, monthlyLimit: null };

  it('uses the common provider and model unless the feature chooses its own', () => {
    expect(effectiveChoice(common, { enabled: true, provider: null, model: null })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5', backup: 'openai' });
    expect(effectiveChoice(common, { enabled: true, provider: 'openai', model: 'special' })).toEqual({ provider: 'openai', model: 'special', backup: null });
    expect(effectiveChoice(common, { enabled: true, provider: 'openai', model: null })).toEqual({ provider: 'openai', model: 'oa-model', backup: null });
    expect(effectiveChoice({ ...common, provider: null }, { enabled: true, provider: null, model: null })).toEqual({ provider: null, model: null, backup: null });
  });

  it('only sets a provider up with both a key and a model', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant' };
    expect((await makeClient('anthropic', 'claude-opus-5-5', env))?.provider).toBe('anthropic');
    expect(await makeClient('anthropic', null, env)).toBeNull();
    expect(await makeClient(null, 'x', env)).toBeNull();
  });
});

describe('AI layer — provider adapters', () => {
  function fakeAnthropic(reply: Partial<Anthropic.Beta.Messages.BetaMessage>) {
    const sent: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
    const client: AnthropicMessagesClient = {
      beta: { messages: { create: async params => { sent.push(params); return { stop_reason: 'end_turn', content: [], ...reply } as Anthropic.Beta.Messages.BetaMessage; } } },
    };
    return { client, sent };
  }
  function fakeOpenAI(reply: Partial<OpenAI.Responses.Response> & { output_text?: string }) {
    const sent: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const client: OpenAIResponsesClient = {
      responses: { create: async params => { sent.push(params); return { status: 'completed', output: [], output_text: '', ...reply } as unknown as OpenAI.Responses.Response; } },
    };
    return { client, sent };
  }

  it('Anthropic: sends the PDF with the task’s instructions and answer format, and reads the JSON back', async () => {
    const { client, sent } = fakeAnthropic({
      content: [{ type: 'text', text: JSON.stringify(GOOD) } as Anthropic.Beta.Messages.BetaTextBlock],
      usage: { input_tokens: 1200, output_tokens: 300 } as Anthropic.Beta.Messages.BetaUsage,
    });
    expect(await anthropicClient({ client }).runJson(TASK)).toEqual({ data: GOOD, usage: USAGE });
    expect(sent[0].model).toBe('claude-opus-5-5');
    expect(sent[0].output_config?.format).toEqual({ type: 'json_schema', schema: TASK.schema });
    const content = sent[0].messages[0].content as { type: string; source?: { media_type: string }; text?: string }[];
    expect(content.map(c => c.type)).toEqual(['document', 'text']);
    expect(content[1].text).toBe('Read it');
  });

  it('Anthropic: turns a declined or cut-off answer into a message people can act on', async () => {
    await expect(anthropicClient({ client: fakeAnthropic({ stop_reason: 'refusal' }).client }).runJson(TASK)).rejects.toThrow('declined');
    await expect(anthropicClient({ client: fakeAnthropic({ stop_reason: 'max_tokens' }).client }).runJson(TASK)).rejects.toThrow('too long');
    const garbled = fakeAnthropic({ content: [{ type: 'text', text: 'not json' } as Anthropic.Beta.Messages.BetaTextBlock] });
    await expect(anthropicClient({ client: garbled.client }).runJson(TASK)).rejects.toBeInstanceOf(AiError);
  });

  it('OpenAI: sends the PDF as a file with a strict answer format, and reads the JSON back', async () => {
    const { client, sent } = fakeOpenAI({ output_text: JSON.stringify(GOOD), usage: { input_tokens: 1200, output_tokens: 300 } as OpenAI.Responses.ResponseUsage });
    expect(await openaiClient({ client, model: 'some-model' }).runJson(TASK)).toEqual({ data: GOOD, usage: USAGE });
    expect(sent[0].model).toBe('some-model');
    expect(sent[0].text?.format).toMatchObject({ type: 'json_schema', name: 'thing', strict: true });
    const content = (sent[0].input as { content: { type: string; file_data?: string }[] }[])[0].content;
    expect(content.map(c => c.type)).toEqual(['input_file', 'input_text']);
    expect(content[0].file_data?.startsWith('data:application/pdf;base64,')).toBe(true);
  });

  it('lists each provider’s models for the picker — newest first, leaving out deprecated and non-text models', async () => {
    const page = <T,>(items: T[]) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
    const anthropicModels = { models: { list: () => page([
      { id: 'claude-new', display_name: 'Claude New', deprecated_at: null },
      { id: 'claude-old', display_name: 'Claude Old', deprecated_at: '2026-01-01T00:00:00Z' },
    ] as Anthropic.Models.ModelInfo[]) } };
    expect(await listAnthropicModels('k', anthropicModels)).toEqual([{ id: 'claude-new', label: 'Claude New' }]);
    const openaiModels = { models: { list: () => page([
      { id: 'text-a', created: 100 }, { id: 'text-b', created: 200 }, { id: 'text-embedding-3', created: 300 }, { id: 'tts-1', created: 400 },
    ] as OpenAI.Models.Model[]) } };
    expect(await listOpenAIModels('k', openaiModels)).toEqual([{ id: 'text-b', label: 'text-b' }, { id: 'text-a', label: 'text-a' }]);
  });

  it('OpenAI: turns a refusal or an unfinished answer into a message people can act on', async () => {
    const refusal = fakeOpenAI({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] as unknown as OpenAI.Responses.ResponseOutputItem[] });
    await expect(openaiClient({ client: refusal.client, model: 'm' }).runJson(TASK)).rejects.toThrow('declined');
    const cut = fakeOpenAI({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
    await expect(openaiClient({ client: cut.client, model: 'm' }).runJson(TASK)).rejects.toThrow('too long');
  });
});
