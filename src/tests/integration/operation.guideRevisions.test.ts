import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  users, sopTemplates, sopSteps, sopTemplateRevisions, sopCategories, sopTemplateCategories,
} from '../../db/schema.js';
import { approveRevision, createRevision, rejectRevision, resubmitRevision, returnRevision, startTrial } from '../../controllers/sop-revisions.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Operation → Improvement Inbox: staff propose changes to a how-to guide;
// approving one rewrites the live guide everyone follows. Real handlers,
// real (test) DB.

const NOW = new Date('2026-01-01T00:00:00Z');
const REVIEWER = { id: 'u-reviewer', email: 'reviewer@kindertech.test', role: 'ADMIN', teacherId: null };

const revision = (id: string, o: Partial<typeof sopTemplateRevisions.$inferInsert> = {}): typeof sopTemplateRevisions.$inferInsert => ({
  id, title: 'Morning drop-off v2', goal: 'Safe, calm arrivals', status: 'PENDING',
  stepsJson: [
    { section: 'Arrival', title: 'Greet the parent by name' },
    { section: 'Arrival', title: 'Temperature check' },
    { section: 'Handover', title: 'Sign the attendance sheet' },
  ],
  proposedByUserId: 'u-teacher', proposedByName: 'Tina', createdAt: NOW, updatedAt: NOW, ...o,
});

beforeEach(async () => {
  await resetTables(sopTemplateCategories, sopCategories, sopSteps, sopTemplateRevisions, sopTemplates, users);
  await db.insert(users).values({ id: REVIEWER.id, email: REVIEWER.email, name: 'Rina Reviewer', passwordHash: 'x', role: 'ADMIN', activated: true, createdAt: NOW, updatedAt: NOW });
  await db.insert(sopTemplates).values({ id: 'sop-1', title: 'Morning drop-off', currentVersion: 3, createdAt: NOW, updatedAt: NOW });
  await db.insert(sopSteps).values([
    { id: 'old-1', sopTemplateId: 'sop-1', section: 'Main', title: 'Old step A', createdAt: NOW, updatedAt: NOW },
    { id: 'old-2', sopTemplateId: 'sop-1', section: 'Main', title: 'Old step B', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(sopCategories).values({ id: 'cat-safety', name: 'Safety', color: '#dc2626', createdAt: NOW, updatedAt: NOW });
});
afterAll(async () => {
  await pool.end();
});

const approve = async (id: string) => { const r = res(); await approveRevision(reqWith({ user: REVIEWER, params: { id } }), r); return r; };
const reject = async (id: string, reviewNote?: string) => { const r = res(); await rejectRevision(reqWith({ user: REVIEWER, params: { id }, body: { reviewNote } }), r); return r; };
const liveSteps = (templateId: string) => db.select().from(sopSteps)
  .where(and(eq(sopSteps.sopTemplateId, templateId), isNull(sopSteps.deletedAt))).orderBy(sopSteps.displayOrder);

describe('Operation — approving guide improvements', () => {
  it('replaces a guide\'s steps with the approved ones, in order', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    await approve('rev-1');
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Greet the parent by name', 'Temperature check', 'Sign the attendance sheet']);
  });

  it('bumps the guide\'s version and updates its title', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    const r = await approve('rev-1');
    const [tpl] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, 'sop-1'));
    expect(tpl).toMatchObject({ currentVersion: 4, title: 'Morning drop-off v2' });
    expect(r.body).toMatchObject({ status: 'APPROVED', versionNumber: 4 });
  });

  it('keeps the old steps (hidden) so past observation results still make sense', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    await approve('rev-1');
    const old = await db.select().from(sopSteps).where(eq(sopSteps.id, 'old-1'));
    expect(old).toHaveLength(1);
    expect(old[0].deletedAt).not.toBeNull();
  });

  it('creates a brand-new guide at version 1 when the proposal is for a new one', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-new', { sopTemplateId: null, title: 'Fire drill', status: 'TRIAL' }));
    const r = await approve('rev-new');
    const newId = r.body.sopTemplateId as string;
    const [tpl] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, newId));
    expect(tpl).toMatchObject({ title: 'Fire drill', currentVersion: 1 });
    expect(await liveSteps(newId)).toHaveLength(3);
  });

  it('records who approved it and when', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    const r = await approve('rev-1');
    expect(r.body.reviewedByName).toBe('Rina Reviewer');
    expect(r.body.reviewedAt).toBeTruthy();
  });

  it('applies the proposed categories to the guide', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL', categoryIdsJson: ['cat-safety', 'cat-safety'] }));
    await approve('rev-1');
    const cats = await db.select().from(sopTemplateCategories).where(eq(sopTemplateCategories.sopTemplateId, 'sop-1'));
    expect(cats.map(c => c.categoryId)).toEqual(['cat-safety']); // de-duplicated
  });

  it('cannot approve the same proposal twice', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    await approve('rev-1');
    expect((await approve('rev-1')).statusCode).toBe(409);
    const [tpl] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, 'sop-1'));
    expect(tpl.currentVersion).toBe(4); // not bumped again
  });

  it('lets a reviewer publish their own draft directly', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-draft', { sopTemplateId: 'sop-1', status: 'DRAFT' }));
    expect((await approve('rev-draft')).body.status).toBe('APPROVED');
  });
});

describe('Operation — rejecting guide improvements', () => {
  it('leaves the live guide untouched and keeps the reviewer\'s note', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    const r = await reject('rev-1', 'Temperature checks are covered by the nurse');
    expect(r.body).toMatchObject({ status: 'REJECTED', reviewNote: 'Temperature checks are covered by the nurse' });
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Old step A', 'Old step B']);
  });

  it('cannot reject a proposal that was already approved', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    await approve('rev-1');
    expect((await reject('rev-1')).statusCode).toBe(409);
  });
});

describe('Operation — suggesting an improvement starts with why', () => {
  const TEACHER = { id: 'u-teacher', email: 'tina@kindertech.test', role: 'USER', teacherId: null };
  const suggestion = (o: Record<string, unknown> = {}) => ({
    sopTemplateId: 'sop-1', title: 'Morning drop-off', goal: 'Safe, calm arrivals',
    steps: [{ section: 'Arrival', title: 'Greet the parent by name' }], ...o,
  });
  const propose = async (user: typeof TEACHER, body: Record<string, unknown>) => {
    const r = res();
    await createRevision(reqWith({ user, body }), r);
    return r;
  };
  beforeEach(async () => {
    await db.insert(users).values({ id: TEACHER.id, email: TEACHER.email, name: 'Tina Teacher', passwordHash: 'x', role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW });
  });

  it('asks a teacher to say why before suggesting changes to an existing guide', async () => {
    expect((await propose(TEACHER, suggestion())).statusCode).toBe(400);
    expect((await propose(TEACHER, suggestion({ improvementReasons: ['  ', ''] }))).body.message).toMatch(/why this guide needs improving/);
    expect(await db.select().from(sopTemplateRevisions)).toHaveLength(0);
  });

  it('keeps the teacher\'s reasons with the suggestion, tidied, for the reviewer to read', async () => {
    const r = await propose(TEACHER, suggestion({ improvementReasons: ['  Step 3 is out of date ', '', 'Parents  now sign in on the tablet'] }));
    expect(r.statusCode).toBe(200);
    expect(r.body.improvementReasonsJson).toEqual(['Step 3 is out of date', 'Parents now sign in on the tablet']);
    expect(r.body.status).toBe('PENDING');
  });

  it('does not ask a supervisor editing directly, or someone suggesting a brand-new guide', async () => {
    expect((await propose(REVIEWER, suggestion())).statusCode).toBe(200);
    const fresh = await propose(TEACHER, suggestion({ sopTemplateId: null, title: 'Fire drill' }));
    expect(fresh.statusCode).toBe(200);
    expect(fresh.body.improvementReasonsJson).toBeNull();
  });
});

describe('Operation — sending a suggestion back for changes', () => {
  const TEACHER = { id: 'u-teacher', email: 'tina@kindertech.test', role: 'USER', teacherId: null };
  const OTHER = { id: 'u-other', email: 'omar@kindertech.test', role: 'USER', teacherId: null };
  const sendBack = async (id: string, reviewNote: unknown) => { const r = res(); await returnRevision(reqWith({ user: REVIEWER, params: { id }, body: { reviewNote } }), r); return r; };
  const resubmit = async (user: typeof TEACHER, id: string, body: Record<string, unknown>) => { const r = res(); await resubmitRevision(reqWith({ user, params: { id }, body }), r); return r; };
  const changes = (o: Record<string, unknown> = {}) => ({
    title: 'Morning drop-off v3', goal: 'Safe, calm arrivals', improvementReasons: ['Parents now sign in on the tablet'],
    steps: [{ section: 'Arrival', title: 'Greet the parent by name' }, { section: 'Arrival', title: 'Tablet sign-in' }], ...o,
  });
  beforeEach(async () => {
    await db.insert(users).values([
      { id: TEACHER.id, email: TEACHER.email, name: 'Tina Teacher', passwordHash: 'x', role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW },
      { id: OTHER.id, email: OTHER.email, name: 'Omar Other', passwordHash: 'x', role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW },
    ]);
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', improvementReasonsJson: ['Out of date'] }));
  });

  it('returns it to the teacher with the supervisor\'s feedback, leaving the live guide untouched', async () => {
    const r = await sendBack('rev-1', '  Add the tablet sign-in step  ');
    expect(r.body).toMatchObject({ status: 'CHANGES_REQUESTED', reviewNote: 'Add the tablet sign-in step', reviewedByName: 'Rina Reviewer' });
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Old step A', 'Old step B']);
  });

  it('needs feedback to send it back — the teacher must know what to change', async () => {
    expect((await sendBack('rev-1', '   ')).statusCode).toBe(400);
    expect((await sendBack('rev-1', undefined)).statusCode).toBe(400);
    const [row] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, 'rev-1'));
    expect(row.status).toBe('PENDING');
  });

  it('keeps the supervisor\'s comments on individual steps, in order — enough on their own without an overall note', async () => {
    const r = res();
    await returnRevision(reqWith({ user: REVIEWER, params: { id: 'rev-1' }, body: { comments: [
      { section: 'Arrival', stepTitle: 'Temperature check', comment: ' Say which thermometer ' },
      { section: 'Handover', stepTitle: 'Sign the attendance sheet', comment: '   ' },
    ] } }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ status: 'CHANGES_REQUESTED', reviewNote: null });
    expect(r.body.reviewCommentsJson).toEqual([{ section: 'Arrival', stepTitle: 'Temperature check', comment: 'Say which thermometer' }]);
  });

  it('cannot be approved or edited by a reviewer while it is with the teacher', async () => {
    await sendBack('rev-1', 'Add the tablet step');
    expect((await approve('rev-1')).statusCode).toBe(409);
    expect((await sendBack('rev-1', 'Again')).statusCode).toBe(409);
  });

  it('lets the teacher change it and send it back into review, keeping the feedback for the reviewer', async () => {
    await sendBack('rev-1', 'Add the tablet step');
    const r = await resubmit(TEACHER, 'rev-1', changes());
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ status: 'PENDING', title: 'Morning drop-off v3', reviewNote: 'Add the tablet step' });
    expect((r.body.stepsJson as { title: string }[]).map(s => s.title)).toEqual(['Greet the parent by name', 'Tablet sign-in']);
    expect(r.body.improvementReasonsJson).toEqual(['Parents now sign in on the tablet']);
  });

  it('only lets the person who sent it resubmit, and only after it was sent back', async () => {
    expect((await resubmit(TEACHER, 'rev-1', changes())).statusCode).toBe(409); // still in review
    await sendBack('rev-1', 'Add the tablet step');
    expect((await resubmit(OTHER, 'rev-1', changes())).statusCode).toBe(404);
    const [row] = await db.select().from(sopTemplateRevisions).where(eq(sopTemplateRevisions.id, 'rev-1'));
    expect(row).toMatchObject({ status: 'CHANGES_REQUESTED', title: 'Morning drop-off v2' });
  });

  it('still asks the teacher why the guide needs improving when resubmitting', async () => {
    await sendBack('rev-1', 'Add the tablet step');
    const r = await resubmit(TEACHER, 'rev-1', changes({ improvementReasons: [] }));
    expect(r.statusCode).toBe(400);
  });
});

describe('Operation — trying a suggestion in practice before deciding', () => {
  const trial = async (id: string) => { const r = res(); await startTrial(reqWith({ user: REVIEWER, params: { id } }), r); return r; };
  beforeEach(async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
  });

  it('cannot approve a suggestion that has not been tried out yet', async () => {
    const r = await approve('rev-1');
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/Try it out first/);
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Old step A', 'Old step B']);
  });

  it('puts it on trial, noting who started it and when, without changing the live guide', async () => {
    const r = await trial('rev-1');
    expect(r.body).toMatchObject({ status: 'TRIAL', trialStartedByName: 'Rina Reviewer' });
    expect(r.body.trialStartedAt).toBeTruthy();
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Old step A', 'Old step B']);
  });

  it('after the trial, can approve it, reject it, or send it back for changes', async () => {
    await trial('rev-1');
    expect((await approve('rev-1')).body.status).toBe('APPROVED');
    await db.insert(sopTemplateRevisions).values(revision('rev-2', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    expect((await reject('rev-2', 'Took too long at the door')).body.status).toBe('REJECTED');
    await db.insert(sopTemplateRevisions).values(revision('rev-3', { sopTemplateId: 'sop-1', status: 'TRIAL' }));
    const r = res();
    await returnRevision(reqWith({ user: REVIEWER, params: { id: 'rev-3' }, body: { reviewNote: 'Step 2 was confusing in practice' } }), r);
    expect(r.body.status).toBe('CHANGES_REQUESTED');
  });

  it('only puts a suggestion in review on trial', async () => {
    await trial('rev-1');
    expect((await trial('rev-1')).statusCode).toBe(409);
  });
});
