import Anthropic from '@anthropic-ai/sdk';
import { AiError, type AiAnswer, type AiClient, type AiJsonTask, type ModelOption } from './types.js';

// Anthropic (Claude) behind the AI layer. Translates only: a task in, the
// parsed answer out. Deciding what to do with it is the feature's job.

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
/** Answers are small structured data; this leaves plenty of room so one is never cut off. */
const MAX_OUTPUT_TOKENS = 16000;
/** Reading printed figures needs care, not deep reasoning. */
const EFFORT = 'medium' as const;
/** If the model declines, the API re-runs the request on a fallback model it picks. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The part of the SDK client this adapter uses — a test can hand in a fake. */
export interface AnthropicMessagesClient {
  beta: { messages: { create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage> } };
}

export function anthropicClient(opts: { apiKey?: string; model?: string; client?: AnthropicMessagesClient }): AiClient {
  const model = opts.model || ANTHROPIC_DEFAULT_MODEL;
  const client: AnthropicMessagesClient = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  return {
    provider: 'anthropic',
    model,
    async runJson(task: AiJsonTask): Promise<AiAnswer> {
      const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
      if (task.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: task.pdf.toString('base64') } });
      content.push({ type: 'text', text: task.instructions });
      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await client.beta.messages.create({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: EFFORT, format: { type: 'json_schema', schema: task.schema } },
          messages: [{ role: 'user', content }],
        });
      } catch (e) {
        throw new AiError(friendlyApiError(e));
      }
      if (message.stop_reason === 'refusal') throw new AiError('The AI declined this request.');
      if (message.stop_reason === 'max_tokens') throw new AiError('This is too long for the AI to handle in one go.');
      const text = message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
      const usage = message.usage ? { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } : null;
      try {
        return { data: JSON.parse(text) as unknown, usage };
      } catch {
        throw new AiError('The AI gave an answer that couldn’t be understood. Try again.');
      }
    },
  };
}

/** Settings → AI → Test connection: the key works and the model exists. Looks the model up — no tokens used. */
export async function checkAnthropic(apiKey: string, model: string): Promise<string | null> {
  try {
    await new Anthropic({ apiKey }).models.retrieve(model);
    return null;
  } catch (e) {
    return e instanceof Anthropic.NotFoundError ? `Anthropic has no model called “${model}”.` : friendlyApiError(e);
  }
}

/** The part of the SDK client the model list uses — a test can hand in a fake. */
export interface AnthropicModelsClient { models: { list(): AsyncIterable<Anthropic.Models.ModelInfo> } }

/** Settings → AI → the model picker: the models this key can use, newest first (deprecated ones left out). */
export async function listAnthropicModels(apiKey: string, client: AnthropicModelsClient = new Anthropic({ apiKey })): Promise<ModelOption[]> {
  const out: ModelOption[] = [];
  for await (const m of client.models.list()) {
    if (!m.deprecated_at) out.push({ id: m.id, label: m.display_name || m.id });
  }
  return out;
}

/** What went wrong talking to Anthropic, in plain words. Most specific first. */
function friendlyApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return 'The AI key isn’t valid. Ask an admin to check it in Settings → AI.';
  }
  if (e instanceof Anthropic.RateLimitError) return 'The AI is busy. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return 'The AI couldn’t open this file. Is it a readable PDF?';
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the AI. Try again shortly.';
  return 'The AI had a problem. Try again shortly.';
}
