import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  apiKeyFor, clearApiKey, commonModelFor, effectiveChoice, loadCommonConfig, loadFeatureConfigs, providerStatuses,
  saveApiKey, saveCommonConfig, saveFeatureConfig, type CommonAiConfig, type FeatureAiConfig,
} from '../services/ai/config.js';
import { AI_FEATURES, PROVIDERS, PROVIDER_IDS, isAiFeatureKey, isProviderId, type ProviderId } from '../services/ai/registry.js';
import type { ModelOption } from '../services/ai/types.js';
import { providerStats, usageThisMonth } from '../services/ai/usage.js';
import { compareProviders } from '../services/pnlReading/compare.js';
import { AiError } from '../services/ai/types.js';

// Settings → AI (admins): the providers and keys every AI feature shares,
// the default + backup provider and monthly limit, and each feature's own
// choices (grouped by category on the page). Keys are write-only.

/** The most requests a month can be limited to — a typo guard, not a business rule. */
const MAX_MONTHLY_LIMIT = 10_000;
/** How long a provider's model list is reused before asking the provider again. */
const MODEL_LIST_TTL_MS = 10 * 60_000;
const modelLists = new Map<ProviderId, { at: number; models: ModelOption[] }>();

async function settingsView() {
  const [common, featureConfigs, providers, usage, stats] = await Promise.all([loadCommonConfig(), loadFeatureConfigs(), providerStatuses(), usageThisMonth(), providerStats()]);
  const hasKey = new Set(providers.filter(p => p.keySource && !p.keyUnreadable).map(p => p.id));
  const features = AI_FEATURES.map(f => {
    const config = featureConfigs[f.key];
    const choice = effectiveChoice(common, config);
    const ready = config.enabled && !!choice.provider && !!choice.model && hasKey.has(choice.provider);
    return { ...f, config, effective: { ...choice, ready } };
  });
  return { common, providers, features, usage, stats };
}

export async function getAiSettings(_req: Request, res: Response): Promise<void> {
  res.json(await settingsView());
}

const providerOrNull = z.enum(PROVIDER_IDS as [string, ...string[]]).nullable();
const commonSchema = z.object({
  provider: providerOrNull,
  backup: providerOrNull,
  models: z.record(z.string().trim().max(80)).default({}),
  monthlyLimit: z.number().int().min(1).max(MAX_MONTHLY_LIMIT).nullable(),
});

/** Providers with a working API key — the only ones that may be newly chosen. */
async function usableProviders(): Promise<Set<ProviderId>> {
  return new Set((await providerStatuses()).filter(s => s.keySource && !s.keyUnreadable).map(s => s.id));
}
const noKeyMessage = (p: ProviderId) => `${PROVIDERS[p].label} has no working API key — add one in the Providers tab first.`;

export async function putAiCommon(req: Request, res: Response): Promise<void> {
  const parsed = commonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Some AI settings are invalid.' }); return; }
  const c = parsed.data as CommonAiConfig;
  if (c.backup && c.backup === c.provider) { res.status(400).json({ message: 'The backup must be a different provider.' }); return; }
  const models = Object.fromEntries(Object.entries(c.models).filter(([p, m]) => isProviderId(p) && m));
  const next: CommonAiConfig = { provider: c.provider, backup: c.backup, models, monthlyLimit: c.monthlyLimit };
  for (const p of [next.provider, next.backup]) {
    if (p && !commonModelFor(next, p)) { res.status(400).json({ message: `Enter the ${PROVIDERS[p].label} model to use.` }); return; }
  }
  // Only a provider that can be used (it has a working key) may be newly chosen as the default or backup.
  // One already saved can stay while its key is sorted out, so the rest of the settings can still be saved.
  const [saved, usable] = await Promise.all([loadCommonConfig(), usableProviders()]);
  for (const [p, was] of [[next.provider, saved.provider], [next.backup, saved.backup]] as const) {
    if (p && p !== was && !usable.has(p)) { res.status(400).json({ message: noKeyMessage(p) }); return; }
  }
  await saveCommonConfig(next);
  res.json(await settingsView());
}

const featureSchema = z.object({
  enabled: z.boolean(),
  provider: providerOrNull,
  model: z.string().trim().max(80).nullable(),
});

export async function putAiFeature(req: Request, res: Response): Promise<void> {
  if (!isAiFeatureKey(req.params.key)) { res.status(404).json({ message: 'Unknown AI feature' }); return; }
  const parsed = featureSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Some settings for this feature are invalid.' }); return; }
  const f = parsed.data as FeatureAiConfig;
  const next: FeatureAiConfig = { enabled: f.enabled, provider: f.provider, model: f.provider ? (f.model || null) : null };
  // A feature's own provider follows the same rule: only one with a working key may be newly chosen.
  const was = (await loadFeatureConfigs())[req.params.key].provider;
  if (next.provider && next.provider !== was && !(await usableProviders()).has(next.provider)) {
    res.status(400).json({ message: noKeyMessage(next.provider) }); return;
  }
  if (next.provider && !next.model && !commonModelFor(await loadCommonConfig(), next.provider)) {
    res.status(400).json({ message: `Enter the ${PROVIDERS[next.provider].label} model for this feature.` }); return;
  }
  await saveFeatureConfig(req.params.key, next);
  res.json(await settingsView());
}

const keySchema = z.object({ key: z.string().trim().min(8, 'That doesn’t look like an API key.').max(400) });

export async function putAiKey(req: Request, res: Response): Promise<void> {
  if (!isProviderId(req.params.provider)) { res.status(404).json({ message: 'Unknown provider' }); return; }
  const parsed = keySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Enter the API key.' }); return; }
  await saveApiKey(req.params.provider, parsed.data.key);
  modelLists.delete(req.params.provider);
  res.json(await settingsView());
}

export async function deleteAiKey(req: Request, res: Response): Promise<void> {
  if (!isProviderId(req.params.provider)) { res.status(404).json({ message: 'Unknown provider' }); return; }
  await clearApiKey(req.params.provider);
  modelLists.delete(req.params.provider);
  res.json(await settingsView());
}

const testSchema = z.object({ provider: z.string(), model: z.string().trim().max(80).optional() });

/** Checks a provider's key and model work — looks the model up, no tokens used. */
export async function testAiProvider(req: Request, res: Response): Promise<void> {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success || !isProviderId(parsed.data.provider)) { res.status(400).json({ message: 'Choose a provider.' }); return; }
  const p = parsed.data.provider;
  const key = await apiKeyFor(p);
  if (!key) { res.json({ ok: false, message: `Add an API key for ${PROVIDERS[p].label} first.` }); return; }
  const model = parsed.data.model || commonModelFor(await loadCommonConfig(), p);
  if (!model) { res.json({ ok: false, message: `Enter the ${PROVIDERS[p].label} model to use.` }); return; }
  const problem = await PROVIDERS[p].check(key, model);
  res.json(problem ? { ok: false, message: problem } : { ok: true, message: `Connected — ${model} is ready.` });
}

/** The models a provider's key can use — for Settings → AI's model picker. Never fails the page: on a problem, an empty list and why. */
export async function getAiModels(req: Request, res: Response): Promise<void> {
  const p = req.params.provider;
  if (!isProviderId(p)) { res.status(404).json({ message: 'Unknown provider' }); return; }
  const key = await apiKeyFor(p);
  if (!key) { res.json({ models: [], message: `Add an API key for ${PROVIDERS[p].label} to choose from its models.` }); return; }
  const cached = modelLists.get(p);
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) { res.json({ models: cached.models, message: null }); return; }
  try {
    const models = await PROVIDERS[p].listModels(key);
    modelLists.set(p, { at: Date.now(), models });
    res.json({ models, message: null });
  } catch {
    res.json({ models: [], message: `Couldn’t load ${PROVIDERS[p].label}’s models — check the key, or type the model under “Other”.` });
  }
}

/** Test site only: read one P&L with every provider that has a key, side by side. Imports nothing. */
export async function comparePnlReading(req: Request, res: Response): Promise<void> {
  if (!req.file) { res.status(400).json({ message: 'Choose a PDF file.' }); return; }
  try {
    res.json(await compareProviders(req.file.buffer, req.user!.id));
  } catch (e) {
    if (e instanceof AiError) { res.status(422).json({ message: e.message }); return; }
    throw e;
  }
}
