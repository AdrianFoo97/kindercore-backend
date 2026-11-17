import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '../../db/client.js';
import { appraisalRatingScales } from '../../db/schema.js';
import {
  createAppraisalRatingScale, deleteAppraisalRatingScale, listAppraisalRatingScales, setAppraisalRatingScaleActive, setDefaultAppraisalRatingScale, updateAppraisalRatingScale,
} from '../../controllers/appraisal-rating-scales.controller.js';
import { ensureStarterRatingScale } from '../../services/appraisalRatingScales.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Settings → Rating scales: named rating scales (a word and "what it looks
// like" per level) that a criterion copies when it's scored on a rating. One
// is the default, preselected for new criteria. Real handlers, test DB.

const call = async (handler: (rq: any, rs: any) => Promise<void>, params: Record<string, string> = {}, body: unknown = {}) => {
  const r = res();
  await handler(reqWith({ params, body }), r);
  return r;
};
const threeLevels = (name: string) => ({
  name, max: 3,
  levels: [{ value: 1, label: 'Not yet', description: '  ' }, { value: 2, label: 'Sometimes' }, { value: 3, label: 'Always', description: 'Every time, unprompted.' }],
});

beforeEach(async () => { await resetTables(appraisalRatingScales); });
afterAll(async () => { await pool.end(); });

describe('Appraisal rating scales', () => {
  it('starts every school with one default scale, named level by level', async () => {
    await ensureStarterRatingScale();
    await ensureStarterRatingScale();
    const list = (await call(listAppraisalRatingScales)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Standard 1–5', max: 5, isDefault: true });
    expect(list[0].levels.map((l: any) => l.label)).toEqual(['Needs improvement', 'Developing', 'Meets expectations', 'Exceeds expectations', 'Outstanding']);
  });

  it('saves a new scale with a name for every level, leaving out blank descriptions', async () => {
    const r = await call(createAppraisalRatingScale, {}, threeLevels('Habits'));
    expect(r.statusCode).toBe(201);
    // The first scale there is becomes the default.
    expect(r.body).toMatchObject({ name: 'Habits', max: 3, isDefault: true });
    expect(r.body.levels).toEqual([{ value: 1, label: 'Not yet' }, { value: 2, label: 'Sometimes' }, { value: 3, label: 'Always', description: 'Every time, unprompted.' }]);
    const edited = await call(updateAppraisalRatingScale, { id: r.body.id }, { ...threeLevels('Daily habits') });
    expect(edited.body.name).toBe('Daily habits');
  });

  it('refuses a level without a name, or a level count that does not match the scale', async () => {
    const noName = threeLevels('Habits');
    noName.levels[1].label = ' ';
    expect((await call(createAppraisalRatingScale, {}, noName)).statusCode).toBe(400);
    expect((await call(createAppraisalRatingScale, {}, { ...threeLevels('Habits'), max: 4 })).statusCode).toBe(400);
  });

  it('can be made inactive (kept, not offered) — never the default, which becomes active again if picked', async () => {
    const first = (await call(createAppraisalRatingScale, {}, threeLevels('A'))).body;
    const second = (await call(createAppraisalRatingScale, {}, threeLevels('B'))).body;
    expect(second.isActive).toBe(true);
    expect((await call(setAppraisalRatingScaleActive, { id: second.id }, { active: false })).body.isActive).toBe(false);
    expect((await call(setAppraisalRatingScaleActive, { id: first.id }, { active: false })).statusCode).toBe(409);
    const list = (await call(setDefaultAppraisalRatingScale, { id: second.id })).body;
    expect(list.find((s: any) => s.id === second.id)).toMatchObject({ isDefault: true, isActive: true });
  });

  it('keeps exactly one default, and will not delete it', async () => {
    const first = (await call(createAppraisalRatingScale, {}, threeLevels('A'))).body;
    const second = (await call(createAppraisalRatingScale, {}, threeLevels('B'))).body;
    expect(second.isDefault).toBe(false);
    expect((await call(deleteAppraisalRatingScale, { id: first.id })).statusCode).toBe(409);
    const list = (await call(setDefaultAppraisalRatingScale, { id: second.id })).body;
    expect(list.filter((s: any) => s.isDefault).map((s: any) => s.name)).toEqual(['B']);
    expect((await call(deleteAppraisalRatingScale, { id: first.id })).statusCode).toBe(204);
  });
});