// The app's AI layer — shared by every AI feature (P&L reading today; more
// later). Features never talk to an AI company directly: they hand a task to
// the runner (run.ts), which picks the provider from Settings → AI.

/** Tokens a request used, as the provider reports them (null if it didn't). */
export interface AiUsage { inputTokens: number; outputTokens: number }

/** A provider's answer: plain data (already JSON-parsed) plus what it cost. */
export interface AiAnswer { data: unknown; usage: AiUsage | null }

/**
 * The one kind of task the layer runs today: read the attached document(s)
 * and answer in a fixed JSON format. Add more task kinds here as features
 * need them (each adapter then implements them).
 */
export interface AiJsonTask {
  instructions: string;
  /** JSON schema of the answer (strict: every property required, no extras). */
  schema: Record<string, unknown>;
  /** Short name for the answer format (some providers require one). */
  schemaName: string;
  /** A PDF to read, if any. */
  pdf?: Buffer;
  /** A document's text to read (e.g. a spreadsheet as CSV), if any — sent before the instructions. */
  documentText?: string;
}

/** Draw one picture from a description (e.g. a guide's poster). */
export interface AiImageTask {
  prompt: string;
  /** Portrait for a poster. */
  orientation: 'portrait' | 'square' | 'landscape';
}

/** A drawn picture, plus what it cost. */
export interface AiImage {
  data: Buffer; mimeType: string; usage: AiUsage | null;
  /** The model that drew it, when it isn't the client's own (e.g. an image model behind a text-model setting). */
  model?: string;
}

/** One provider + model, ready to run tasks. Adapters translate only — they never decide. */
export interface AiClient {
  provider: string;
  model: string;
  runJson(task: AiJsonTask): Promise<AiAnswer>;
  /** Only providers that can draw have this (OpenAI today; Claude can't make images). */
  makeImage?(task: AiImageTask): Promise<AiImage>;
}

/** A model offered in Settings → AI's model picker. */
export interface ModelOption { id: string; label: string }

/** A request that couldn't be done — the message is safe to show to the person using the feature. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

/** A document's text, fenced so the model reads it as data, never as instructions. */
export const documentBlock = (text: string) => `<document>
${text}
</document>`;
