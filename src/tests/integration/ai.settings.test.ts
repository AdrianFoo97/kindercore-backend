import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { like } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { deleteAiKey, getAiSettings, putAiCommon, putAiFeature, putAiKey } from '../../controllers/ai.controller.js';
import { aiFeatureStatus, aiSetup } from '../../services/ai/run.js';
import { reqWith, res } from './http.js';

// Settings → AI, through the real handlers: the providers, keys and limit
// every AI feature shares, and each feature's own choices. API keys go in,
// are stored encrypted, and never come back out.

const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' };
const KEY = 'sk-ant-test-0123456789-abcd';

beforeEach(async () => {
  await db.delete(systemSettings).where(like(systemSettings.key, 'secret.ai.%'));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
afterAll(async () => { await pool.end(); });

const call = async (fn: typeof getAiSettings, body: object = {}, params: Record<string, string> = {}) => {
  const r = res();
  await fn(reqWith({ user: ADMIN, body, params }), r);
  return r;
};
type FeatureView = { key: string; category: string; effective: { provider: string | null; model: string | null; ready: boolean } };
const feature = (body: { features: FeatureView[] }, key: string) => body.features.find(f => f.key === key)!;

describe('Settings — AI (shared by every AI feature)', () => {
  it('stores an API key encrypted and never sends it back — only where it came from and its last 4 characters', async () => {
    const r = await call(putAiKey, { key: KEY }, { provider: 'anthropic' });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(r.body.providers.find((p: { id: string }) => p.id === 'anthropic')).toMatchObject({ keySource: 'settings', keyHint: 'abcd', keyUnreadable: false });
    const [stored] = await db.select().from(systemSettings).where(like(systemSettings.key, 'secret.ai.key.anthropic'));
    expect(JSON.stringify(stored.value)).not.toContain('0123456789');
  });

  it('turns a feature on once the common provider has a key — and off again when the key is removed', async () => {
    expect((await aiFeatureStatus('pnl-reading')).available).toBe(false);
    await call(putAiKey, { key: KEY }, { provider: 'anthropic' });
    const saved = await call(putAiCommon, { provider: 'anthropic', backup: null, models: {}, monthlyLimit: 30 });
    expect(feature(saved.body, 'pnl-reading')).toMatchObject({ category: 'Finance', effective: { provider: 'anthropic', model: 'claude-opus-5-5', ready: true } });
    expect(await aiFeatureStatus('pnl-reading')).toEqual({ available: true, provider: 'anthropic', model: 'claude-opus-5-5' });
    expect((await aiSetup('pnl-reading')).monthlyLimit).toBe(30);
    await call(deleteAiKey, {}, { provider: 'anthropic' });
    expect((await aiFeatureStatus('pnl-reading')).available).toBe(false);
  });

  it('lets one feature be switched off, or use its own provider and model, without changing the others', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-a';
    process.env.OPENAI_API_KEY = 'sk-env-o';
    await call(putAiCommon, { provider: 'anthropic', backup: null, models: {}, monthlyLimit: null });
    const own = await call(putAiFeature, { enabled: true, provider: 'openai', model: 'some-model' }, { key: 'pnl-reading' });
    expect(feature(own.body, 'pnl-reading').effective).toMatchObject({ provider: 'openai', model: 'some-model', ready: true });
    expect(await aiFeatureStatus('pnl-reading')).toMatchObject({ available: true, provider: 'openai' });
    await call(putAiFeature, { enabled: false, provider: null, model: null }, { key: 'pnl-reading' });
    expect((await aiFeatureStatus('pnl-reading')).available).toBe(false);
  });

  it('prefers a key in the server’s environment over one saved in Settings', async () => {
    process.env.OPENAI_API_KEY = 'sk-from-env';
    const r = await call(getAiSettings);
    expect(r.body.providers.find((p: { id: string }) => p.id === 'openai')).toMatchObject({ keySource: 'env', keyHint: null });
  });

  it('refuses a backup that’s the same provider, OpenAI without a model, an unknown feature, or a silly limit', async () => {
    expect((await call(putAiCommon, { provider: 'anthropic', backup: 'anthropic', models: {}, monthlyLimit: null })).statusCode).toBe(400);
    expect((await call(putAiCommon, { provider: 'openai', backup: null, models: {}, monthlyLimit: null })).statusCode).toBe(400);
    expect((await call(putAiCommon, { provider: 'anthropic', backup: null, models: {}, monthlyLimit: 0 })).statusCode).toBe(400);
    expect((await call(putAiFeature, { enabled: true, provider: 'openai', model: null }, { key: 'pnl-reading' })).statusCode).toBe(400);
    expect((await call(putAiFeature, { enabled: true, provider: null, model: null }, { key: 'nope' })).statusCode).toBe(404);
    expect((await call(putAiKey, { key: 'short' }, { provider: 'anthropic' })).statusCode).toBe(400);
  });
});
