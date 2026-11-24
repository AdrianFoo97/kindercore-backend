import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, pool } from '../../db/client.js';
import { aiRequests, userAuthRoles, users } from '../../db/schema.js';
import { useAiForTests } from '../../services/ai/run.js';
import type { AiJsonTask } from '../../services/ai/types.js';
import { keepsPlaceholders, placeholdersOf } from '../../services/messageRewrite/index.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Message templates → Rewrite with AI, over real HTTP with a stand-in AI.

const MESSAGE = '您好，这是Ten Toes Preschool。感谢您对{{childName}}的询问。您想安排参观学校吗？';
let server: LiveServer;
let marketing: Caller;
let finance: Caller;
let lastTask: AiJsonTask | null = null;
const answer = (text: string) => useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async task => { lastTask = task; return { data: { text }, usage: null }; } } });

beforeAll(async () => {
  await resetTables(aiRequests, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-mkt', email: 'mkt@kindertech.test', role: 'USER', authRoleId: 'builtin:MARKETING_EXECUTIVE' }),
    await activeUser({ id: 'u-fin', email: 'fin@kindertech.test', role: 'USER', authRoleId: 'builtin:ACCOUNTS_EXECUTIVE' }),
  ]);
  server = await startLiveServer();
  marketing = await signIn(server.base, 'mkt@kindertech.test', PASSWORD);
  finance = await signIn(server.base, 'fin@kindertech.test', PASSWORD);
}, 120_000);
afterEach(() => { useAiForTests(null); lastTask = null; });
afterAll(async () => { await server?.close(); await pool.end(); });

describe('Message templates — rewrite with AI', () => {
  it('knows a message’s placeholders, and whether a rewrite kept exactly those', () => {
    expect(placeholdersOf('Hi {{ parentName }}, {{childName}} and {{childName}}')).toEqual(['{{childName}}', '{{parentName}}']);
    expect(keepsPlaceholders('Hi {{childName}}', 'Dear parent of {{ childName }}')).toBe(true);
    expect(keepsPlaceholders('Hi {{childName}}', 'Hi there')).toBe(false);
    expect(keepsPlaceholders('Hi {{childName}}', 'Hi {{childName}} {{date}}')).toBe(false);
  });

  it('returns a suggestion in the way asked — the message sent as data, nothing saved', async () => {
    answer('您好！我是Ten Toes Preschool。非常感谢您关注{{childName}}的入学，请问您方便安排一次参观吗？');
    const res = await marketing.call('POST', '/api/ai/rewrite-message', { text: MESSAGE, request: 'more professional' });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain('{{childName}}');
    expect(lastTask?.documentText).toBe(MESSAGE);
    expect(lastTask?.instructions).toContain('more professional');
  });

  it('refuses a rewrite that dropped or invented a placeholder — and an empty request', async () => {
    answer('您好！欢迎参观我们的学校。');
    const dropped = await marketing.call('POST', '/api/ai/rewrite-message', { text: MESSAGE, request: 'shorter' });
    expect(dropped.status).toBe(422);
    expect((await marketing.call('POST', '/api/ai/rewrite-message', { text: MESSAGE, request: '  ' })).status).toBe(400);
  });

  it('is for the people who edit message templates (Marketing, HR) — not, say, Finance', async () => {
    answer(MESSAGE);
    expect((await finance.call('POST', '/api/ai/rewrite-message', { text: MESSAGE, request: 'casual' })).status).toBe(403);
  });
});
