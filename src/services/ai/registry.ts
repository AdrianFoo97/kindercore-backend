import { ANTHROPIC_DEFAULT_MODEL, anthropicClient, checkAnthropic, listAnthropicModels } from './anthropic.js';
import { checkOpenAI, listOpenAIModels, openaiClient } from './openai.js';
import type { AiClient, ModelOption } from './types.js';

// What the AI layer knows about: the providers it can use, and the app's
// features that use AI. Adding a provider = an adapter + one PROVIDERS entry;
// adding a feature = one AI_FEATURES entry (its settings then appear in
// Settings → AI under its category, with no other change).

interface ProviderInfo {
  label: string;
  /** null = an admin must enter the model (names change often). */
  defaultModel: string | null;
  /** Environment variable holding its key — takes priority over a key saved in Settings. */
  envKey: string;
  make: (apiKey: string, model: string) => AiClient;
  /** Settings → AI → Test connection: null when the key and model work, else why not. */
  check: (apiKey: string, model: string) => Promise<string | null>;
  /** Settings → AI → the model picker: what this key can use. */
  listModels: (apiKey: string) => Promise<ModelOption[]>;
}

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: ANTHROPIC_DEFAULT_MODEL, envKey: 'ANTHROPIC_API_KEY', make: (apiKey, model) => anthropicClient({ apiKey, model }), check: checkAnthropic, listModels: listAnthropicModels },
  openai: { label: 'OpenAI', defaultModel: null, envKey: 'OPENAI_API_KEY', make: (apiKey, model) => openaiClient({ apiKey, model }), check: checkOpenAI, listModels: listOpenAIModels },
} satisfies Record<string, ProviderInfo>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && v in PROVIDERS;
export const providerLabel = (id: string) => (isProviderId(id) ? PROVIDERS[id].label : id);

export interface AiFeature {
  key: string;
  label: string;
  /** The Settings → AI group it's listed under (the area of the app it belongs to). */
  category: string;
  /** One line: what the AI does in this feature. */
  description: string;
}

/** Every feature that uses AI. */
export const AI_FEATURES = [
  { key: 'pnl-reading', label: 'Read P&L statements', category: 'Finance', description: 'Reads the P&L PDF when importing it into Operating Costs.' },
] as const satisfies readonly AiFeature[];

export type AiFeatureKey = typeof AI_FEATURES[number]['key'];
export const isAiFeatureKey = (v: unknown): v is AiFeatureKey => AI_FEATURES.some(f => f.key === v);
