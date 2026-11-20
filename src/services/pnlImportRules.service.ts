import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { operatingCostCategories, operatingCostCategoryGroups, operatingCostImportRules } from '../db/schema.js';
import { normaliseLineName } from './pnlImport.logic.js';
import { ImportProblem } from './pnlImport.service.js';

// Settings → Operating cost → Import rules: the remembered "record into" /
// "always skip" choice for each P&L line name. Imports create them; here an
// admin sees, changes, adds or removes them.

export async function listImportRules() {
  return db.select({
    id: operatingCostImportRules.id, lineName: operatingCostImportRules.lineName, action: operatingCostImportRules.action,
    categoryId: operatingCostImportRules.categoryId, categoryName: operatingCostCategories.name, groupName: operatingCostCategoryGroups.name,
    updatedAt: operatingCostImportRules.updatedAt,
  }).from(operatingCostImportRules)
    .leftJoin(operatingCostCategories, eq(operatingCostCategories.id, operatingCostImportRules.categoryId))
    .leftJoin(operatingCostCategoryGroups, eq(operatingCostCategoryGroups.id, operatingCostCategories.groupId))
    .orderBy(asc(operatingCostImportRules.lineName));
}

export interface RuleInput { action: 'RECORD' | 'SKIP'; categoryId: string | null }

async function checkRule(r: RuleInput): Promise<string | null> {
  if (r.action === 'SKIP') return null;
  if (!r.categoryId) throw new ImportProblem(400, 'Choose the category to record into.');
  const [cat] = await db.select({ id: operatingCostCategories.id }).from(operatingCostCategories).where(eq(operatingCostCategories.id, r.categoryId));
  if (!cat) throw new ImportProblem(400, 'That category no longer exists.');
  return r.categoryId;
}

/** Adds a rule for a line name, or replaces the one already there for that name. */
export async function addImportRule(lineName: string, r: RuleInput): Promise<void> {
  const categoryId = await checkRule(r);
  const lineKey = normaliseLineName(lineName);
  if (!lineKey) throw new ImportProblem(400, 'Enter the line name as it appears on the P&L.');
  const now = new Date();
  await db.insert(operatingCostImportRules).values({ id: randomUUID(), lineKey, lineName: lineName.trim(), action: r.action, categoryId, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { lineName: lineName.trim(), action: r.action, categoryId, updatedAt: now } });
}

export async function updateImportRule(id: string, r: RuleInput): Promise<boolean> {
  const categoryId = await checkRule(r);
  const [row] = await db.select({ id: operatingCostImportRules.id }).from(operatingCostImportRules).where(eq(operatingCostImportRules.id, id));
  if (!row) return false;
  await db.update(operatingCostImportRules).set({ action: r.action, categoryId, updatedAt: new Date() }).where(eq(operatingCostImportRules.id, id));
  return true;
}

export async function deleteImportRule(id: string): Promise<boolean> {
  const [row] = await db.select({ id: operatingCostImportRules.id }).from(operatingCostImportRules).where(eq(operatingCostImportRules.id, id));
  if (!row) return false;
  await db.delete(operatingCostImportRules).where(eq(operatingCostImportRules.id, id));
  return true;
}
