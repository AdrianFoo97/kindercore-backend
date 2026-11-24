import OpenAI from 'openai';
import { AiError, type AiAnswer, type AiClient, type AiImage, type AiImageTask, type AiJsonTask, type ModelOption, documentBlock } from './types.js';

// OpenAI behind the AI layer (Responses API). Translates only — same job as
// the Anthropic adapter. No default model: OpenAI's names change often, so an
// admin enters the one to use in Settings → AI.

/** Answers are small structured data; this leaves plenty of room so one is never cut off. */
const MAX_OUTPUT_TOKENS = 16000;

/** The part of the SDK client this adapter uses — a test can hand in a fake. */
export interface OpenAIResponsesClient {
  responses: { create(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<OpenAI.Responses.Response> };
  images?: { generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<OpenAI.Images.ImagesResponse> };
}

/**
 * Drawing needs an image model. A feature set to OpenAI usually carries the
 * common text model (e.g. a GPT chat model), so that falls back to this one;
 * an admin can pick another image model for the feature in Settings → AI.
 */
export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const isImageModel = (id: string) => /image|dall-e/i.test(id);
const IMAGE_SIZE: Record<AiImageTask['orientation'], '1024x1536' | '1024x1024' | '1536x1024'> = {
  portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024',
};
/** JPEG at this quality keeps a poster a few hundred KB instead of several MB of PNG. */
const IMAGE_JPEG_QUALITY = 90;

export function openaiClient(opts: { apiKey?: string; model: string; client?: OpenAIResponsesClient }): AiClient {
  const client: OpenAIResponsesClient = opts.client ?? new OpenAI({ apiKey: opts.apiKey });
  return {
    provider: 'openai',
    model: opts.model,
    async makeImage(task: AiImageTask): Promise<AiImage> {
      if (!client.images) throw new AiError('This OpenAI connection can’t draw images.');
      const imageModel = isImageModel(opts.model) ? opts.model : OPENAI_IMAGE_MODEL;
      let response: OpenAI.Images.ImagesResponse;
      try {
        response = await client.images.generate({
          model: imageModel,
          prompt: task.prompt,
          size: IMAGE_SIZE[task.orientation],
          quality: 'high',
          output_format: 'jpeg',
          output_compression: IMAGE_JPEG_QUALITY,
          n: 1,
        });
      } catch (e) {
        throw new AiError(friendlyApiError(e, 'The AI couldn’t draw this. Try again, or shorten the step titles.'));
      }
      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new AiError('The AI didn’t return a picture. Try again.');
      const usage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null;
      return { data: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg', usage, model: imageModel };
    },
    async runJson(task: AiJsonTask): Promise<AiAnswer> {
      const content: OpenAI.Responses.ResponseInputContent[] = [];
      if (task.pdf) content.push({ type: 'input_file', filename: 'document.pdf', file_data: `data:application/pdf;base64,${task.pdf.toString('base64')}` });
      if (task.documentText !== undefined) content.push({ type: 'input_text', text: documentBlock(task.documentText) });
      content.push({ type: 'input_text', text: task.instructions });
      let response: OpenAI.Responses.Response;
      try {
        response = await client.responses.create({
          model: opts.model,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [{ role: 'user', content }],
          text: { format: { type: 'json_schema', name: task.schemaName, strict: true, schema: task.schema } },
        });
      } catch (e) {
        throw new AiError(friendlyApiError(e));
      }
      const refused = response.output.some(o => o.type === 'message' && o.content.some(c => c.type === 'refusal'));
      if (refused) throw new AiError('The AI declined this request.');
      if (response.status === 'incomplete') {
        throw new AiError(response.incomplete_details?.reason === 'max_output_tokens'
          ? 'This is too long for the AI to handle in one go.'
          : 'The AI stopped before finishing. Try again.');
      }
      const usage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null;
      try {
        return { data: JSON.parse(response.output_text) as unknown, usage };
      } catch {
        throw new AiError('The AI gave an answer that couldn’t be understood. Try again.');
      }
    },
  };
}

/** Settings → AI → Test connection: the key works and the model exists. Looks the model up — no tokens used. */
export async function checkOpenAI(apiKey: string, model: string): Promise<string | null> {
  try {
    await new OpenAI({ apiKey }).models.retrieve(model);
    return null;
  } catch (e) {
    return e instanceof OpenAI.NotFoundError ? `OpenAI has no model called “${model}”.` : friendlyApiError(e);
  }
}

/**
 * OpenAI lists every model it has, including ones that can't read a document
 * and answer in text (embeddings, speech, images…). Names containing these
 * are left out of the picker; "Other…" still allows anything.
 */
const NOT_TEXT_MODELS = ['embedding', 'tts', 'whisper', 'dall-e', 'moderation', 'audio', 'realtime', 'transcribe', 'image', 'search', 'babbage', 'davinci'];
export const isTextModel = (id: string) => !NOT_TEXT_MODELS.some(w => id.toLowerCase().includes(w));

/** The part of the SDK client the model list uses — a test can hand in a fake. */
export interface OpenAIModelsClient { models: { list(): AsyncIterable<OpenAI.Models.Model> } }

/** Settings → AI → the model picker: the text models this key can use, newest first. */
export async function listOpenAIModels(apiKey: string, client: OpenAIModelsClient = new OpenAI({ apiKey })): Promise<ModelOption[]> {
  const models: OpenAI.Models.Model[] = [];
  for await (const m of client.models.list()) if (isTextModel(m.id)) models.push(m);
  return models.sort((a, b) => b.created - a.created).map(m => ({ id: m.id, label: m.id }));
}

/** What went wrong talking to OpenAI, in plain words. Most specific first. */
function friendlyApiError(e: unknown, badRequest = 'The AI couldn’t open this file. Is it a readable PDF?'): string {
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return 'The AI key isn’t valid. Ask an admin to check it in Settings → AI.';
  }
  if (e instanceof OpenAI.NotFoundError) return 'The AI model wasn’t found. Ask an admin to check it in Settings → AI.';
  if (e instanceof OpenAI.RateLimitError) return 'The AI is busy or out of credit. Try again later.';
  if (e instanceof OpenAI.BadRequestError) return badRequest;
  if (e instanceof OpenAI.APIConnectionError) return 'Couldn’t reach the AI. Try again shortly.';
  return 'The AI had a problem. Try again shortly.';
}
