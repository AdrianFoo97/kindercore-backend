import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { sopCategories, sopSteps, sopTemplateCategories, sopTemplateRevisions, sopTemplates, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Author Guides → Import from a spreadsheet. The page reads the file
// (frontend sopImport.ts, unit-tested there) and sends the server exactly
// this draft. Over real HTTP, as a supervisor: it lands as their private
// draft, reads back intact for the editor, and publishing it keeps every
// step, category and linked guide.

const NOW = new Date('2026-01-01T00:00:00Z');

let server: LiveServer;
let supervisor: Caller;

beforeAll(async () => {
  await resetTables(sopTemplateCategories, sopSteps, sopTemplateRevisions, sopTemplates, sopCategories, userAuthRoles, users);
  await db.insert(users).values(await activeUser({ id: 'u-sup', email: 'sup@kindertech.test', role: 'USER', authRoleId: 'builtin:SUPERVISOR' }));
  await db.insert(sopTemplates).values({ id: 'g-first-aid', title: 'First Aid', createdAt: NOW, updatedAt: NOW });
  await db.insert(sopCategories).values({ id: 'cat-hygiene', name: 'Hygiene', color: '#0d9488', createdAt: NOW, updatedAt: NOW });
  server = await startLiveServer();
  supervisor = await signIn(server.base, 'sup@kindertech.test', PASSWORD);
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

/** What the import sends for a filled-in template (see readSopWorkbook). */
const IMPORTED = {
  sopTemplateId: null, title: 'Hand washing', goal: 'Clean hands every time', videoUrl: 'https://youtu.be/abc',
  categoryIds: ['cat-hygiene'], asDraft: true,
  steps: [
    { section: 'Before Class', title: 'Wet hands', detail: 'Warm water', linkedTemplateId: null },
    { section: 'During Class', title: 'If someone is hurt', detail: null, linkedTemplateId: 'g-first-aid' },
  ],
};

describe('Author Guides — an imported guide', () => {
  it('lands as the importer’s own draft, listed under Drafts in progress, with every step, category and link', async () => {
    const created = await supervisor.call('POST', '/api/sop-revisions', IMPORTED);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ status: 'DRAFT', sopTemplateId: null, title: 'Hand washing' });

    const drafts = await supervisor.call('GET', '/api/sop-revisions?status=DRAFT');
    expect((drafts.body as { id: string }[]).map(d => d.id)).toEqual([created.body.id]);

    const back = await supervisor.call('GET', `/api/sop-revisions/${created.body.id}`);
    expect(back.body).toMatchObject({ goal: 'Clean hands every time', videoUrl: 'https://youtu.be/abc', categoryIdsJson: ['cat-hygiene'], stepsJson: IMPORTED.steps });
  });

  it('becomes a live guide when published — the linked guide kept on its step', async () => {
    const created = await supervisor.call('POST', '/api/sop-revisions', { ...IMPORTED, title: 'Hand washing 2' });
    const approved = await supervisor.call('POST', `/api/sop-revisions/${created.body.id}/approve`, {});
    expect(approved.status).toBe(200);
    const templateId = approved.body.sopTemplateId as string;
    expect(templateId).toBeTruthy();
    const steps = (await supervisor.call('GET', `/api/sop-steps?sopTemplateId=${templateId}`)).body as { title: string; linkedTemplateId: string | null }[];
    expect(steps.map(s => [s.title, s.linkedTemplateId])).toEqual([['Wet hands', null], ['If someone is hurt', 'g-first-aid']]);
  });
});
