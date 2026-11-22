import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { aiRequests, operatingCostImports, systemSettings, userAuthRoles, users } from '../../db/schema.js';
import { useAiForTests } from '../../services/ai/run.js';
import { saveApiKey } from '../../services/ai/config.js';
import { resetTables } from './testDb.js';
import { anonymous, signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { makePdf, SAMPLE_PNL_LINES, SAMPLE_PNL_READING } from '../fixtures/pnlPdf.js';
import { like } from 'drizzle-orm';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';

// An attacker's-eye run at the real app: each test is an attack that must
// FAIL. Written while pen-testing the P&L import and AI features; kept so a
// regression shows up as a red test.

const NOW = new Date('2026-01-01T00:00:00Z');
const ADMIN = { id: 'u-atk-admin', email: 'atk-admin@kindertech.test' };
const FIN = { id: 'u-atk-fin', email: 'atk-fin@kindertech.test' };
const SECRET_KEY = 'sk-ant-attack-test-SECRET-9876';
const PDF = makePdf(SAMPLE_PNL_LINES);

let server: LiveServer;
let admin: Caller;
let finance: Caller;

beforeAll(async () => {
  await resetTables(aiRequests, operatingCostImports, userAuthRoles, users);
  await db.delete(systemSettings).where(like(systemSettings.key, 'secret.ai.%'));
  await db.insert(users).values([
    await activeUser({ id: ADMIN.id, email: ADMIN.email, name: 'Ada Admin' }),
    await activeUser({ id: FIN.id, email: FIN.email, name: 'Fina Finance', role: 'USER' }),
  ]);
  await db.insert(userAuthRoles).values({ id: 'uar-atk-fin', userId: FIN.id, authRoleId: 'builtin:ACCOUNTS_EXECUTIVE', createdAt: NOW });
  await saveApiKey('anthropic', SECRET_KEY);
  useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async () => ({ data: SAMPLE_PNL_READING, usage: null }) } });
  server = await startLiveServer();
  admin = await signIn(server.base, ADMIN.email, PASSWORD);
  finance = await signIn(server.base, FIN.email, PASSWORD);
}, 120_000);
afterAll(async () => { useAiForTests(null); await server?.close(); await pool.end(); });

/** A P&L upload as \`who\`, the way the browser sends it. */
async function uploadPnl(who: Caller, file: Buffer, type = 'application/pdf'): Promise<number> {
  const fd = new FormData();
  fd.append('file', new Blob([file], { type }), 'pnl.pdf');
  const res = await fetch(`${server.base}/api/operating-cost/import/read`, {
    method: 'POST', body: fd, headers: { cookie: who.cookie!, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE },
  });
  return res.status;
}

describe('Attacker — AI and P&L import', () => {
  it('a Finance user can’t point the AI at their own account or key (to receive every P&L)', async () => {
    expect((await finance.call('PUT', '/api/ai/settings', { provider: 'openai', backup: null, models: { openai: 'x' }, monthlyLimit: null })).status).toBe(403);
    expect((await finance.call('PUT', '/api/ai/keys/openai', { key: 'sk-attacker-owned-key-123' })).status).toBe(403);
    expect((await finance.call('PUT', '/api/ai/features/pnl-reading', { enabled: true, provider: 'openai', model: 'x' })).status).toBe(403);
  });

  it('stored API keys never leave the server — not in any settings response, and not writable through the generic settings route', async () => {
    const all = JSON.stringify((await admin.call('GET', '/api/settings')).body);
    expect(all).not.toContain('secret.');
    expect(all).not.toContain('SECRET-9876');
    expect(JSON.stringify((await admin.call('GET', '/api/ai/settings')).body)).not.toContain('SECRET-9876');
    expect((await admin.call('PATCH', '/api/settings/secret.ai.config', { value: { provider: 'openai' } })).status).toBeGreaterThanOrEqual(400);
  });

  it('a changing request without the app’s header is refused (cross-site request forgery)', async () => {
    const r = await finance.call('POST', '/api/operating-cost/import/notices/x/dismiss', {}, { appHeader: false });
    expect(r.status).toBe(403);
  });

  it('a disguised non-PDF upload is refused cleanly — no crash', async () => {
    const status = await uploadPnl(finance, Buffer.from('<?php system($_GET["c"]); ?> definitely not a pdf'));
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('one account can’t run up the AI bill by hammering the P&L reader', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push(await uploadPnl(finance, PDF));
    expect(statuses).toContain(429);
  });
});

describe('Attacker — the front door', () => {
  it('a huge request body from someone not signed in is refused before the server reads it', async () => {
    const big = JSON.stringify({ email: 'x@y.z', password: 'a'.repeat(3 * 1024 * 1024) });
    const res = await fetch(`${server.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    expect(res.status).toBe(413);
  });

  it('login takes about as long for an email that doesn’t exist as for a wrong password (no account fishing by timing)', async () => {
    const time = async (email: string) => {
      const started = performance.now();
      await anonymous(server.base).call('POST', '/api/auth/login', { email, password: 'wrong-password-1' });
      return performance.now() - started;
    };
    const tries = 5;
    let known = 0; let unknown = 0;
    for (let i = 0; i < tries; i++) { known += await time(FIN.email); unknown += await time(`nobody-${i}@kindertech.test`); }
    // A real account costs a password hash check; an unknown email must cost the same.
    expect(unknown / known).toBeGreaterThan(0.5);
  });
});
