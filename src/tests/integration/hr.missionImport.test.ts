import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { and, inArray, isNull } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { aiRequests, careerMissions, missionCategories, positions, userAuthRoles, users } from '../../db/schema.js';
import { useAiForTests } from '../../services/ai/run.js';
import type { AiJsonTask } from '../../services/ai/types.js';
import type { MissionDraft } from '../../services/missionImport/reading.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { makePdf } from '../fixtures/pnlPdf.js';

// Settings → Career missions / Mission categories → Import with AI, over real
// HTTP with a stand-in AI (never a real call). Made-up missions only.

const NOW = new Date('2026-01-01T00:00:00Z');
const READING: MissionDraft = {
  categories: [{ name: 'Teaching', achievementName: null, description: null }, { name: 'Parent Care', achievementName: 'Parent Pro', description: null }],
  missions: [
    { title: 'Lead circle time', position: 'Junior EI', category: 'Teaching', description: 'Run it for a week', whyItMatters: null, evidenceRequirements: 'Observation', difficulty: 'BASIC', required: true, highPriority: false },
    { title: 'Run a parents’ morning', position: 'Junior EI', category: 'Parent Care', description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'ADVANCED', required: false, highPriority: true },
  ],
};

let server: LiveServer;
let manager: Caller;
let lead: Caller;
let lastTask: AiJsonTask | null = null;

beforeAll(async () => {
  await resetTables(aiRequests, careerMissions, missionCategories, positions, userAuthRoles, users);
  await db.insert(positions).values({ positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW } as typeof positions.$inferInsert);
  await db.insert(missionCategories).values({ code: 'TEACH', name: 'Teaching', achievementName: 'Teacher', icon: 'faStar', color: '#1e40af', createdAt: NOW, updatedAt: NOW });
  await db.insert(users).values([
    await activeUser({ id: 'u-hrm', email: 'hrm@kindertech.test', role: 'USER', authRoleId: 'builtin:HR_MANAGER' }),
    await activeUser({ id: 'u-lead', email: 'lead@kindertech.test', role: 'USER', authRoleId: 'builtin:TEAM_LEAD' }),
  ]);
  server = await startLiveServer();
  manager = await signIn(server.base, 'hrm@kindertech.test', PASSWORD);
  lead = await signIn(server.base, 'lead@kindertech.test', PASSWORD);
}, 120_000);
beforeEach(() => {
  lastTask = null;
  useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async task => { lastTask = task; return { data: READING, usage: null }; } } });
});
afterEach(() => useAiForTests(null));
afterAll(async () => { await server?.close(); await pool.end(); });

function xlsxFile(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mission', 'Position'], ['Lead circle time', 'Junior EI']]), 'Missions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const read = (who: Caller, file: Buffer) => who.call('POST', '/api/career-missions/import/read', { fileName: 'missions', fileBase64: file.toString('base64') });

describe('Career missions — Import with AI', () => {
  it('reads an Excel file (as its text) or a PDF into a preview — matched to positions and categories, saving nothing', async () => {
    const fromExcel = await read(manager, xlsxFile());
    expect(fromExcel.status).toBe(200);
    expect(lastTask?.documentText).toContain('Lead circle time');
    expect(lastTask?.pdf).toBeUndefined();
    expect(fromExcel.body.categories).toMatchObject([{ name: 'Teaching', existingCode: 'TEACH' }, { name: 'Parent Care', existingCode: null, code: 'PARENT_CARE' }]);
    expect(fromExcel.body.missions.map((m: { positionId: string; categoryCode: string }) => [m.positionId, m.categoryCode])).toEqual([['EI', 'TEACH'], ['EI', 'PARENT_CARE']]);

    const fromPdf = await read(manager, makePdf(['Career missions', 'Lead circle time - Junior EI']));
    expect(fromPdf.status).toBe(200);
    expect(lastTask?.pdf).toBeDefined();
    expect(await db.select().from(careerMissions)).toEqual([]);
  });

  it('reads our template straight from the file — no AI — and lists any value it can’t use, by row', async () => {
    useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async () => { throw new Error('the template must not use the AI'); } } });
    const template = (await manager.call('GET', '/api/career-missions/import/template')).body as { fileName: string; fileBase64: string };
    const wb = XLSX.read(Buffer.from(template.fileBase64, 'base64'), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Career missions', 'New categories', 'Lists']);
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Lists, { header: 1 })[1]?.[0]).toBe('Junior EI');

    XLSX.utils.sheet_add_aoa(wb.Sheets['Career missions'], [['Junior EI', 'Teaching', 'Plan a weekly theme', '', '', '', 'Basic', 'Yes', 'No']], { origin: 'A2' });
    const filled = await read(manager, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(filled.status).toBe(200);
    expect(filled.body).toMatchObject({ provider: 'none', model: 'template', missions: [{ title: 'Plan a weekly theme', positionId: 'EI', categoryCode: 'TEACH' }] });

    XLSX.utils.sheet_add_aoa(wb.Sheets['Career missions'], [['Junior EI', 'Teaching', 'Plan a weekly theme', '', '', '', 'Very hard', 'Yes', 'No']], { origin: 'A2' });
    const wrong = await read(manager, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(wrong.status).toBe(400);
    expect(wrong.body.problems).toEqual(['Career missions sheet, row 2: Difficulty must be Basic, Intermediate or Advanced.']);
  });

  it('refuses a file that is neither Excel nor PDF', async () => {
    const res = await read(manager, Buffer.from('just some text'));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Excel \(\.xlsx\) or PDF/);
  });

  it('creates exactly what the person kept — new categories first, then missions at the end of each position’s list', async () => {
    const res = await manager.call('POST', '/api/career-missions/import/apply', {
      categories: [{ code: 'PARENT_CARE', name: 'Parent Care', achievementName: 'Parent Pro', description: null, icon: 'faStar', color: '#0e7490' }],
      missions: [{ positionId: 'EI', title: 'Run a parents’ morning', category: 'PARENT_CARE', description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'ADVANCED', required: false, highPriority: true }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ categories: 1, missions: 1 });
    expect(await db.select({ title: careerMissions.title, category: careerMissions.category }).from(careerMissions)).toEqual([{ title: 'Run a parents’ morning', category: 'PARENT_CARE' }]);
  });

  it('creates nothing when any part is wrong (a category code that’s taken, or an unknown position)', async () => {
    const before = (await db.select().from(careerMissions)).length;
    const taken = await manager.call('POST', '/api/career-missions/import/apply', {
      categories: [{ code: 'TEACH', name: 'Teaching again', achievementName: 'x', description: null, icon: 'faStar', color: '#0e7490' }],
      missions: [{ positionId: 'EI', title: 'Should not appear', category: 'TEACH', description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'BASIC', required: true, highPriority: false }],
    });
    expect(taken.status).toBe(409);
    const unknown = await manager.call('POST', '/api/career-missions/import/apply', {
      categories: [], missions: [{ positionId: 'NOPE', title: 'Should not appear', category: 'TEACH', description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'BASIC', required: true, highPriority: false }],
    });
    expect(unknown.status).toBe(400);
    expect((await db.select().from(careerMissions)).length).toBe(before);
  });

  it('is for HR Manager and above — a Team Lead can’t read or import', async () => {
    expect((await read(lead, xlsxFile())).status).toBe(403);
    expect((await lead.call('POST', '/api/career-missions/import/apply', { categories: [], missions: [] })).status).toBe(403);
  });
});

describe('Career missions — several at once', () => {
  it('changes the same details on several missions, or archives them — all or nothing, HR Manager and above', async () => {
    await db.insert(careerMissions).values(['b1', 'b2'].map((id, i) => ({
      id, positionId: 'EI', title: `Bulk ${i}`, category: 'TEACH', difficulty: 'BASIC' as const, required: true, highPriority: false, createdAt: NOW, updatedAt: NOW,
    })));
    const set = await manager.call('POST', '/api/career-missions/bulk', { ids: ['b1', 'b2'], set: { difficulty: 'ADVANCED', required: false } });
    expect(set.body).toEqual({ updated: 2 });
    const rows = await db.select({ difficulty: careerMissions.difficulty, required: careerMissions.required }).from(careerMissions).where(inArray(careerMissions.id, ['b1', 'b2']));
    expect(rows).toEqual([{ difficulty: 'ADVANCED', required: false }, { difficulty: 'ADVANCED', required: false }]);

    expect((await manager.call('POST', '/api/career-missions/bulk', { ids: ['b1', 'nope'], delete: true })).status).toBe(404);
    expect((await manager.call('POST', '/api/career-missions/bulk', { ids: ['b1'], set: { category: 'MISSING' } })).status).toBe(400);
    expect((await manager.call('POST', '/api/career-missions/bulk', { ids: ['b1'] })).status).toBe(400);
    expect((await lead.call('POST', '/api/career-missions/bulk', { ids: ['b1'], delete: true })).status).toBe(403);

    expect((await manager.call('POST', '/api/career-missions/bulk', { ids: ['b1', 'b2'], delete: true })).body).toEqual({ updated: 2 });
    const left = await db.select({ id: careerMissions.id }).from(careerMissions).where(and(inArray(careerMissions.id, ['b1', 'b2']), isNull(careerMissions.deletedAt)));
    expect(left).toEqual([]);
  });
});
