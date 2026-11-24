import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { aiRequests, sopSteps, sopTemplates, storedImages, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { useAiForTests } from '../../services/ai/run.js';
import type { AiClient, AiImageTask } from '../../services/ai/types.js';

// How-To Guide → AI poster, over real HTTP with a fake drawer: drawn only
// when asked, checked as a draft first, then saved and simply shown — opening
// it never asks the AI again. Only guide authors can make one.

const NOW = new Date('2026-01-01T00:00:00Z');
let server: LiveServer;
let supervisor: Caller;
let teacher: Caller;
let drawn: AiImageTask[] = [];

const fakeDrawer = (): AiClient => ({
  provider: 'openai', model: 'gpt-test', runJson: async () => ({ data: null, usage: null }),
  makeImage: async task => { drawn.push(task); return { data: Buffer.from(`poster ${drawn.length}`), mimeType: 'image/jpeg', usage: null, model: 'image-test' }; },
});

beforeAll(async () => {
  await resetTables(aiRequests, sopSteps, sopTemplates, storedImages, userAuthRoles, users);
  await db.insert(users).values([
    await activeUser({ id: 'u-sup', email: 'sup@kindertech.test', role: 'USER', authRoleId: 'builtin:SUPERVISOR' }),
    await activeUser({ id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', authRoleId: 'builtin:TEACHER' }),
  ]);
  await db.insert(sopTemplates).values([
    { id: 'g-pick', title: 'Picking', goal: 'Pick the right items', currentVersion: 3, createdAt: NOW, updatedAt: NOW },
    { id: 'g-empty', title: 'Empty', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(sopSteps).values(['Scan the task label', 'Check the quantity'].map((title, i) => (
    { id: `s${i}`, sopTemplateId: 'g-pick', section: 'Main', title, displayOrder: i, createdAt: NOW, updatedAt: NOW })));
  server = await startLiveServer();
  [supervisor, teacher] = await Promise.all(['sup', 'tina'].map(n => signIn(server.base, `${n}@kindertech.test`, PASSWORD)));
}, 120_000);
afterEach(() => useAiForTests(null));
afterAll(async () => { await server?.close(); await pool.end(); });

const guide = async () => (await db.select().from(sopTemplates).where(eq(sopTemplates.id, 'g-pick')))[0];
const picture = (who: Caller, imageId: string) => fetch(`${server.base}/api/sop-templates/g-pick/poster/image/${imageId}`, { headers: { cookie: who.cookie! } });

describe('How-To Guides — AI poster', () => {
  it('is drawn once as a draft from the guide’s steps, then saved as the poster with the guide’s version — opening it doesn’t ask the AI again', async () => {
    useAiForTests({ primary: fakeDrawer() });
    drawn = [];
    const draft = await supervisor.call('POST', '/api/sop-templates/g-pick/poster/draft', {});
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ provider: 'openai', model: 'image-test' });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ orientation: 'portrait' });
    expect(drawn[0].prompt).toContain('1. "Scan the task label"');
    expect((await guide()).posterImageId).toBeNull(); // still only a draft

    expect((await supervisor.call('POST', '/api/sop-templates/g-pick/poster/accept', {})).status).toBe(200);
    const g = await guide();
    expect(g).toMatchObject({ posterImageId: draft.body.draftImageId, posterVersion: 3, posterDraftImageId: null });

    for (let i = 0; i < 3; i++) {
      const res = await picture(teacher, g.posterImageId!);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('poster 1');
    }
    expect(drawn).toHaveLength(1);
  });

  it('a new drawing replaces the poster only once it’s accepted — a discarded one leaves the poster as it was, and no spare pictures are kept', async () => {
    useAiForTests({ primary: fakeDrawer() });
    const before = (await guide()).posterImageId!;
    const first = await supervisor.call('POST', '/api/sop-templates/g-pick/poster/draft', {});
    const second = await supervisor.call('POST', '/api/sop-templates/g-pick/poster/draft', {});
    expect((await picture(supervisor, first.body.draftImageId)).status).toBe(404); // the earlier draft is gone
    expect((await supervisor.call('DELETE', '/api/sop-templates/g-pick/poster/draft')).status).toBe(200);
    expect(await guide()).toMatchObject({ posterImageId: before, posterDraftImageId: null });
    expect((await picture(supervisor, second.body.draftImageId)).status).toBe(404);
    expect((await db.select({ id: storedImages.id }).from(storedImages)).map(r => r.id)).toEqual([before]);
  });

  it('only guide authors can make a poster, it needs steps, and it says plainly when no provider can draw', async () => {
    useAiForTests({ primary: fakeDrawer() });
    expect((await teacher.call('POST', '/api/sop-templates/g-pick/poster/draft', {})).status).toBe(403);
    expect((await teacher.call('POST', '/api/sop-templates/g-pick/poster/accept', {})).status).toBe(403);
    const empty = await supervisor.call('POST', '/api/sop-templates/g-empty/poster/draft', {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/Add steps/);

    useAiForTests({ primary: { provider: 'anthropic', model: 'claude-test', runJson: async () => ({ data: null, usage: null }) } });
    const noDrawer = await supervisor.call('POST', '/api/sop-templates/g-pick/poster/draft', {});
    expect(noDrawer.status).toBe(422);
    expect(noDrawer.body.message).toMatch(/can draw images/);
    expect((await supervisor.call('GET', '/api/sop-templates/poster/ai-status')).body).toMatchObject({ available: false });
  });
});
