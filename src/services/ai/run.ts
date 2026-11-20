import { commonModelFor, effectiveChoice, loadCommonConfig, loadFeatureConfigs, makeClient } from './config.js';
import { providerLabel, type AiFeatureKey } from './registry.js';
import { recordAiRequest, requestsThisMonth, type AiRequestRecord } from './usage.js';
import { AiError, type AiClient, type AiJsonTask } from './types.js';

// The one way every feature runs an AI task. It applies Settings → AI: the
// feature's on/off and provider, the common backup and monthly limit — and
// records every request. A feature supplies only its task, how to read the
// answer, and (optionally) how to check it.

export interface AiSetup { enabled: boolean; primary: AiClient | null; backup: AiClient | null; monthlyLimit: number | null }

/** Tests swap in fake clients (for every feature); null = back to Settings. */
let override: AiSetup | null = null;
export function useAiForTests(setup: Partial<AiSetup> & { primary: AiClient | null } | null): void {
  override = setup ? { enabled: true, backup: null, monthlyLimit: null, ...setup } : null;
}

export async function aiSetup(feature: AiFeatureKey): Promise<AiSetup> {
  if (override) return override;
  const [common, features] = await Promise.all([loadCommonConfig(), loadFeatureConfigs()]);
  const choice = effectiveChoice(common, features[feature]);
  const backupModel = choice.backup ? commonModelFor(common, choice.backup) : null;
  return {
    enabled: features[feature].enabled,
    primary: await makeClient(choice.provider, choice.model),
    backup: await makeClient(choice.backup, backupModel),
    monthlyLimit: common.monthlyLimit,
  };
}

/** Whether a feature can be used right now (switched on, with a provider that has a key and model). */
export async function aiFeatureStatus(feature: AiFeatureKey): Promise<{ available: boolean; provider: string | null; model: string | null }> {
  const s = await aiSetup(feature);
  const available = s.enabled && !!s.primary;
  return { available, provider: available ? s.primary!.provider : null, model: available ? s.primary!.model : null };
}

/** How requests are recorded and limits counted — the database normally; unit tests swap these. */
export interface AiLedger {
  record(r: AiRequestRecord): Promise<void>;
  countThisMonth(provider: string): Promise<number>;
}
const DB_LEDGER: AiLedger = { record: recordAiRequest, countThisMonth: provider => requestsThisMonth(provider) };

export interface RunOptions<T> {
  userId: string;
  /** The answer in the feature's own shape, or null if it doesn't fit. */
  parse: (data: unknown) => T | null;
  /** The feature's checks — an answer that fails them is retried with the backup. */
  passes?: (result: T) => boolean;
  /** Said when the answer doesn't fit the feature's format. */
  incompleteMessage?: string;
}

export interface AiRun<T> {
  result: T;
  provider: string;
  model: string;
  /** Why the backup answered instead of the main provider (null = the main one did). */
  backupReason: string | null;
}

type Attempt<T> = { result: T } | { error: AiError };

async function attempt<T>(feature: string, client: AiClient, task: AiJsonTask, opts: RunOptions<T>, ledger: AiLedger, limit: number | null): Promise<Attempt<T>> {
  if (limit !== null && (await ledger.countThisMonth(client.provider)) >= limit) {
    return { error: new AiError(`This month’s limit of ${limit} AI requests with ${providerLabel(client.provider)} is used up.`) };
  }
  const base = { feature, provider: client.provider, model: client.model, userId: opts.userId };
  try {
    const answer = await client.runJson(task);
    const result = opts.parse(answer.data);
    const passedChecks = result !== null && (opts.passes?.(result) ?? true);
    await ledger.record({ ...base, ok: result !== null, passedChecks, usage: answer.usage });
    return result !== null ? { result } : { error: new AiError(opts.incompleteMessage ?? 'The AI’s answer was incomplete. Try again.') };
  } catch (e) {
    await ledger.record({ ...base, ok: false, passedChecks: false, usage: null });
    if (e instanceof AiError) return { error: e };
    throw e;
  }
}

/**
 * Runs a feature's task with its provider; if that fails, or the answer fails
 * the feature's checks, the backup (if any) tries. Every request is recorded.
 */
export async function runAiTask<T>(feature: AiFeatureKey, task: AiJsonTask, opts: RunOptions<T>, setup?: AiSetup, ledger: AiLedger = DB_LEDGER): Promise<AiRun<T>> {
  const s = setup ?? await aiSetup(feature);
  if (!s.enabled) throw new AiError('This AI feature is switched off in Settings → AI.');
  if (!s.primary) throw new AiError('No AI provider is set up. An admin can set one up in Settings → AI.');
  const passes = (r: T) => opts.passes?.(r) ?? true;
  const done = (client: AiClient, result: T, backupReason: string | null): AiRun<T> => ({ result, provider: client.provider, model: client.model, backupReason });

  const first = await attempt(feature, s.primary, task, opts, ledger, s.monthlyLimit);
  if ('result' in first && passes(first.result)) return done(s.primary, first.result, null);

  if (s.backup) {
    const why = 'error' in first
      ? `${providerLabel(s.primary.provider)} couldn’t do it (${first.error.message})`
      : `${providerLabel(s.primary.provider)}’s answer didn’t pass the checks`;
    const second = await attempt(feature, s.backup, task, opts, ledger, s.monthlyLimit);
    if ('result' in second && ('error' in first || passes(second.result))) return done(s.backup, second.result, why);
  }
  if ('result' in first) return done(s.primary, first.result, null);
  throw first.error;
}
