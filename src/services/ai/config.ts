import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { openSecret, sealSecret } from '../secretBox.js';
import { AI_FEATURES, PROVIDERS, PROVIDER_IDS, isProviderId, type AiFeatureKey, type ProviderId } from './registry.js';
import type { AiClient } from './types.js';

// Settings → AI, stored in system settings under `secret.` keys (never
// returned by GET /api/settings, never writable by the generic PATCH):
//   - common: default + backup provider, each provider's default model, the monthly limit
//   - per feature: on/off, and optionally its own provider + model
//   - each provider's API key, encrypted (secretBox); an environment key wins.

/** Settings every AI feature shares. */
export interface CommonAiConfig {
  provider: ProviderId | null;
  backup: ProviderId | null;
  /** Each provider's default model (empty = the provider's built-in default). */
  models: Partial<Record<ProviderId, string>>;
  /** Most requests per provider per calendar month, across all features (null = no limit). */
  monthlyLimit: number | null;
}

/** One feature's own choices. null provider/model = use the common settings. */
export interface FeatureAiConfig { enabled: boolean; provider: ProviderId | null; model: string | null }

export const DEFAULT_FEATURE_CONFIG: FeatureAiConfig = { enabled: true, provider: null, model: null };

const COMMON_SETTING = 'secret.ai.config';
const FEATURES_SETTING = 'secret.ai.features';
const keySetting = (p: ProviderId) => `secret.ai.key.${p}`;

interface StoredKey { sealed: string; hint: string; savedAt: string }

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (!row) return null;
  return (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T;
}

async function writeSetting(key: string, value: unknown, description: string): Promise<void> {
  const now = new Date();
  const [existing] = await db.select({ id: systemSettings.id }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (existing) await db.update(systemSettings).set({ value, updatedAt: now }).where(eq(systemSettings.id, existing.id));
  else await db.insert(systemSettings).values({ id: randomUUID(), key, value, description, updatedAt: now });
}

/** Before anything is saved in Settings: whatever the server's environment sets up. */
function commonFromEnv(env: NodeJS.ProcessEnv): CommonAiConfig {
  const fromEnv = PROVIDER_IDS.find(p => env[PROVIDERS[p].envKey]);
  const chosen = env.AI_PROVIDER || fromEnv || '';
  const provider = isProviderId(chosen) ? chosen : null;
  return { provider, backup: null, models: provider && env.AI_MODEL ? { [provider]: env.AI_MODEL } : {}, monthlyLimit: null };
}

export async function loadCommonConfig(env: NodeJS.ProcessEnv = process.env): Promise<CommonAiConfig> {
  return (await readSetting<CommonAiConfig>(COMMON_SETTING)) ?? commonFromEnv(env);
}
export const saveCommonConfig = (c: CommonAiConfig) => writeSetting(COMMON_SETTING, c, 'AI: providers, backup, limit');

export async function loadFeatureConfigs(): Promise<Record<AiFeatureKey, FeatureAiConfig>> {
  const saved = (await readSetting<Partial<Record<string, FeatureAiConfig>>>(FEATURES_SETTING)) ?? {};
  return Object.fromEntries(AI_FEATURES.map(f => [f.key, { ...DEFAULT_FEATURE_CONFIG, ...saved[f.key] }])) as Record<AiFeatureKey, FeatureAiConfig>;
}
export async function saveFeatureConfig(key: AiFeatureKey, c: FeatureAiConfig): Promise<void> {
  const all = await loadFeatureConfigs();
  await writeSetting(FEATURES_SETTING, { ...all, [key]: c }, 'AI: per-feature settings');
}

/** The key to use: the server's environment first, then the one saved in Settings. */
export async function apiKeyFor(p: ProviderId, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const fromEnv = env[PROVIDERS[p].envKey];
  if (fromEnv) return fromEnv;
  const stored = await readSetting<StoredKey>(keySetting(p));
  return stored ? openSecret(stored.sealed) : null;
}

export async function saveApiKey(p: ProviderId, key: string): Promise<void> {
  const value: StoredKey = { sealed: sealSecret(key), hint: key.slice(-4), savedAt: new Date().toISOString() };
  await writeSetting(keySetting(p), value, `${PROVIDERS[p].label} API key (encrypted)`);
}

export async function clearApiKey(p: ProviderId): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, keySetting(p)));
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  defaultModel: string | null;
  /** Where its key comes from — the key itself is never returned. */
  keySource: 'env' | 'settings' | null;
  /** Last 4 characters of a key saved in Settings, to tell keys apart. */
  keyHint: string | null;
  /** A saved key that can't be decrypted (the server's secret changed) — re-enter it. */
  keyUnreadable: boolean;
}

export async function providerStatuses(env: NodeJS.ProcessEnv = process.env): Promise<ProviderStatus[]> {
  return Promise.all(PROVIDER_IDS.map(async id => {
    const info = PROVIDERS[id];
    if (env[info.envKey]) return { id, label: info.label, defaultModel: info.defaultModel, keySource: 'env' as const, keyHint: null, keyUnreadable: false };
    const stored = await readSetting<StoredKey>(keySetting(id));
    return {
      id, label: info.label, defaultModel: info.defaultModel,
      keySource: stored ? 'settings' as const : null, keyHint: stored?.hint ?? null,
      keyUnreadable: !!stored && openSecret(stored.sealed) === null,
    };
  }));
}

/** A provider's default model: the one set in Settings → AI, else its built-in default. */
export const commonModelFor = (c: CommonAiConfig, p: ProviderId) => c.models[p]?.trim() || PROVIDERS[p].defaultModel;

/** Which provider + model a feature uses, after its own choices and the common settings. */
export function effectiveChoice(common: CommonAiConfig, feature: FeatureAiConfig): { provider: ProviderId | null; model: string | null; backup: ProviderId | null } {
  const provider = feature.provider ?? common.provider;
  if (!provider) return { provider: null, model: null, backup: null };
  const model = (feature.provider && feature.model?.trim()) || commonModelFor(common, provider);
  const backup = common.backup && common.backup !== provider ? common.backup : null;
  return { provider, model, backup };
}

/** A ready-to-use client, or null if the provider's key or model is missing. */
export async function makeClient(p: ProviderId | null, model: string | null, env: NodeJS.ProcessEnv = process.env): Promise<AiClient | null> {
  if (!p || !model) return null;
  const key = await apiKeyFor(p, env);
  return key ? PROVIDERS[p].make(key, model) : null;
}
