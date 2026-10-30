import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  users, sopTemplates, sopSteps, sopTemplateRevisions, sopCategories, sopTemplateCategories,
} from '../../db/schema.js';
import { approveRevision, rejectRevision } from '../../controllers/sop-revisions.controller.js';
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
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    await approve('rev-1');
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Greet the parent by name', 'Temperature check', 'Sign the attendance sheet']);
  });

  it('bumps the guide\'s version and updates its title', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    const r = await approve('rev-1');
    const [tpl] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, 'sop-1'));
    expect(tpl).toMatchObject({ currentVersion: 4, title: 'Morning drop-off v2' });
    expect(r.body).toMatchObject({ status: 'APPROVED', versionNumber: 4 });
  });

  it('keeps the old steps (hidden) so past observation results still make sense', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    await approve('rev-1');
    const old = await db.select().from(sopSteps).where(eq(sopSteps.id, 'old-1'));
    expect(old).toHaveLength(1);
    expect(old[0].deletedAt).not.toBeNull();
  });

  it('creates a brand-new guide at version 1 when the proposal is for a new one', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-new', { sopTemplateId: null, title: 'Fire drill' }));
    const r = await approve('rev-new');
    const newId = r.body.sopTemplateId as string;
    const [tpl] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, newId));
    expect(tpl).toMatchObject({ title: 'Fire drill', currentVersion: 1 });
    expect(await liveSteps(newId)).toHaveLength(3);
  });

  it('records who approved it and when', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    const r = await approve('rev-1');
    expect(r.body.reviewedByName).toBe('Rina Reviewer');
    expect(r.body.reviewedAt).toBeTruthy();
  });

  it('applies the proposed categories to the guide', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1', categoryIdsJson: ['cat-safety', 'cat-safety'] }));
    await approve('rev-1');
    const cats = await db.select().from(sopTemplateCategories).where(eq(sopTemplateCategories.sopTemplateId, 'sop-1'));
    expect(cats.map(c => c.categoryId)).toEqual(['cat-safety']); // de-duplicated
  });

  it('cannot approve the same proposal twice', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
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
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    const r = await reject('rev-1', 'Temperature checks are covered by the nurse');
    expect(r.body).toMatchObject({ status: 'REJECTED', reviewNote: 'Temperature checks are covered by the nurse' });
    expect((await liveSteps('sop-1')).map(s => s.title)).toEqual(['Old step A', 'Old step B']);
  });

  it('cannot reject a proposal that was already approved', async () => {
    await db.insert(sopTemplateRevisions).values(revision('rev-1', { sopTemplateId: 'sop-1' }));
    await approve('rev-1');
    expect((await reject('rev-1')).statusCode).toBe(409);
  });
});
