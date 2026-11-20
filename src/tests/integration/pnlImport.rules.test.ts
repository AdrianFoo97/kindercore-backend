import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { operatingCostCategories, operatingCostCategoryGroups, operatingCostImportRules } from '../../db/schema.js';
import { getImportRules, postImportRule, putImportRule, removeImportRule } from '../../controllers/pnlImportRules.controller.js';
import { categories, CAT, groups } from '../fixtures/operatingCost.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Settings → Operating cost → Import rules, through the real handlers.

const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN' };

beforeEach(async () => {
  await resetTables(operatingCostImportRules, operatingCostCategories, operatingCostCategoryGroups);
  await db.insert(operatingCostCategoryGroups).values(groups);
  await db.insert(operatingCostCategories).values(categories);
});
afterAll(async () => { await pool.end(); });

const call = async (fn: typeof getImportRules, body: object = {}, params: Record<string, string> = {}) => {
  const r = res();
  await fn(reqWith({ user: ADMIN, body, params }), r);
  return r;
};

describe('Settings — P&L import rules', () => {
  it('adds, changes and removes the remembered choice for a P&L line', async () => {
    const added = await call(postImportRule, { lineName: 'Fire Extinguisher', action: 'RECORD', categoryId: CAT.capex });
    expect(added.statusCode).toBe(201);
    expect(added.body).toEqual([expect.objectContaining({ lineName: 'Fire Extinguisher', action: 'RECORD', categoryName: 'Capex', groupName: 'Fixed costs' })]);
    const id = added.body[0].id;
    expect((await call(putImportRule, { action: 'SKIP', categoryId: null }, { id })).body[0]).toMatchObject({ action: 'SKIP', categoryId: null });
    expect((await call(removeImportRule, {}, { id })).body).toEqual([]);
  });

  it('needs a category that exists to record into', async () => {
    expect((await call(postImportRule, { lineName: 'Petrol', action: 'RECORD', categoryId: null })).statusCode).toBe(400);
    expect((await call(postImportRule, { lineName: 'Petrol', action: 'RECORD', categoryId: 'gone' })).statusCode).toBe(400);
    expect((await call(getImportRules)).body).toEqual([]);
  });
});
