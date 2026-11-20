import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  operatingCostCategories, operatingCostCategoryGroups, operatingCostImportRules, operatingCostImports, operatingCosts, users,
} from '../db/schema.js';
import { readStatement, type StatementDraft, type StatementReading } from './pnlReading/index.js';
import { TextReadError, readStatementText } from './pnlReading/textReader.js';
import { pdfText } from './pdfText.js';
import {
  DEFAULT_SKIP_LINES, checkReading, normaliseLineName, planImport, previewLines, readingPasses,
  type CategoryRef, type ImportRule, type LineDecision, type PreviewLine, type SectionCheck,
} from './pnlImport.logic.js';

// P&L import into Operating Costs: read → check → preview (nothing saved),
// then apply what the person decided, in one transaction. The PDF itself is
// never stored.

/** A refusal the person importing can act on (HTTP status + message). */
export class ImportProblem extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function categoryRefs(): Promise<CategoryRef[]> {
  return db.select({
    id: operatingCostCategories.id, name: operatingCostCategories.name,
    groupId: operatingCostCategories.groupId, groupName: operatingCostCategoryGroups.name,
  }).from(operatingCostCategories)
    .innerJoin(operatingCostCategoryGroups, eq(operatingCostCategoryGroups.id, operatingCostCategories.groupId))
    .orderBy(operatingCostCategoryGroups.sortOrder, operatingCostCategories.sortOrder);
}

async function rulesByKey(): Promise<Map<string, ImportRule>> {
  const rows = await db.select().from(operatingCostImportRules);
  return new Map(rows.map(r => [r.lineKey, { lineKey: r.lineKey, action: r.action, categoryId: r.categoryId }]));
}

/** Amounts already entered for a month, by category. `month` is 0-11, as stored. */
async function existingAmounts(year: number, month: number): Promise<Map<string, number>> {
  const rows = await db.select({ categoryId: operatingCosts.categoryId, amount: operatingCosts.amount })
    .from(operatingCosts).where(and(eq(operatingCosts.year, year), eq(operatingCosts.month, month)));
  return new Map(rows.map(r => [r.categoryId, r.amount]));
}

export interface ImportPreview {
  /** Month 1-12 as printed on the statement. */
  period: StatementDraft['period'];
  provider: string;
  model: string;
  instructionsVersion: number;
  /** Why the backup provider read it (null = the main one did). */
  backupReason: string | null;
  hasText: boolean;
  sections: (SectionCheck & { title: string; kind: string })[];
  lines: PreviewLine[];
  /** Amounts already entered for that month, by category id. */
  existing: Record<string, number>;
  categories: CategoryRef[];
  groups: { id: string; name: string }[];
}

/** Who reads the P&L when no AI is used — recorded on the import like an AI provider would be. */
export const NO_AI = { provider: 'none', model: 'pdf-text', instructionsVersion: 0 } as const;

/** Reads the P&L from its own printed text, without AI (the person chose to, or AI is off). */
function readWithoutAi(text: string): StatementReading {
  try {
    return { draft: readStatementText(text), ...NO_AI, backupReason: null };
  } catch (e) {
    if (e instanceof TextReadError) throw new ImportProblem(422, e.message);
    throw e;
  }
}

/**
 * Reads and checks a P&L and says what importing it would do. Saves nothing.
 * `withoutAi`: read the PDF's printed text instead of asking the AI.
 */
export async function previewImport(pdf: Buffer, userId: string, opts: { withoutAi?: boolean } = {}): Promise<ImportPreview> {
  const text = await pdfText(pdf);
  const reading = opts.withoutAi
    ? readWithoutAi(text)
    : await readStatement(pdf, { userId, passes: draft => readingPasses(draft, checkReading(draft, text)) });
  const check = checkReading(reading.draft, text);
  const [categories, rules, groups] = await Promise.all([
    categoryRefs(), rulesByKey(),
    db.select({ id: operatingCostCategoryGroups.id, name: operatingCostCategoryGroups.name })
      .from(operatingCostCategoryGroups).orderBy(operatingCostCategoryGroups.sortOrder),
  ]);
  const { year, month } = reading.draft.period;
  return {
    period: reading.draft.period,
    provider: reading.provider,
    model: reading.model,
    instructionsVersion: reading.instructionsVersion,
    backupReason: reading.backupReason,
    hasText: check.hasText,
    sections: reading.draft.sections.map((s, i) => ({
      title: s.title, kind: s.kind,
      sum: check.sections[i].sum, printedSubtotal: check.sections[i].printedSubtotal, addsUp: check.sections[i].addsUp,
    })),
    lines: previewLines(reading.draft, check, categories, rules),
    existing: Object.fromEntries(await existingAmounts(year, month - 1)),
    categories,
    groups,
  };
}

export interface NewCategory { tempId: string; name: string; groupId: string }

export interface ApplyInput {
  year: number;
  /** 1-12. */
  month: number;
  fileName: string;
  provider: string;
  model: string;
  instructionsVersion: number;
  /** Cost lines only; a RECORD into a new category uses its tempId. */
  lines: LineDecision[];
  newCategories: NewCategory[];
}

export interface ApplyResult { importId: string; recordedCount: number; recordedTotal: number; notImportedCount: number }

/** Writes an import: new categories (admins), amounts, remembered rules, and the record of what was left out. */
export async function applyImport(input: ApplyInput, who: { id: string; email: string; isAdmin: boolean }): Promise<ApplyResult> {
  if (input.newCategories.length && !who.isAdmin) throw new ImportProblem(403, 'Only an admin can add new categories.');
  const known = new Set((await categoryRefs()).map(c => c.id));
  const groupIds = new Set((await db.select({ id: operatingCostCategoryGroups.id }).from(operatingCostCategoryGroups)).map(g => g.id));
  const idFor = new Map<string, string>(input.newCategories.map(n => [n.tempId, randomUUID()]));
  for (const n of input.newCategories) {
    if (!groupIds.has(n.groupId)) throw new ImportProblem(400, `The group for “${n.name}” no longer exists.`);
  }
  const lines = input.lines.map(l => ({ ...l, categoryId: l.categoryId ? (idFor.get(l.categoryId) ?? l.categoryId) : null }));
  for (const l of lines) {
    if (l.action === 'RECORD' && (!l.categoryId || !(known.has(l.categoryId) || [...idFor.values()].includes(l.categoryId)))) {
      throw new ImportProblem(400, `Choose a category for “${l.name}”.`);
    }
  }

  const month0 = input.month - 1;
  const plan = planImport(lines, await existingAmounts(input.year, month0));
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, who.id));
  const importId = randomUUID();
  const now = new Date();
  const recordedTotal = Math.round(plan.writes.reduce((t, w) => t + w.amount, 0) * 100) / 100;

  await db.transaction(async tx => {
    for (const n of input.newCategories) {
      const [{ next }] = await tx.select({ next: sql<number>`COALESCE(MAX(${operatingCostCategories.sortOrder}), -1) + 1` })
        .from(operatingCostCategories).where(eq(operatingCostCategories.groupId, n.groupId));
      await tx.insert(operatingCostCategories).values({
        id: idFor.get(n.tempId)!, name: n.name.trim(), groupId: n.groupId, sortOrder: Number(next), createdAt: now, updatedAt: now,
      });
    }
    for (const w of plan.writes) {
      const [row] = await tx.select({ id: operatingCosts.id }).from(operatingCosts).where(and(
        eq(operatingCosts.year, input.year), eq(operatingCosts.month, month0), eq(operatingCosts.categoryId, w.categoryId)));
      if (row) {
        await tx.update(operatingCosts).set({ amount: w.amount, importId, updatedAt: now }).where(eq(operatingCosts.id, row.id));
      } else {
        await tx.insert(operatingCosts).values({
          id: randomUUID(), year: input.year, month: month0, categoryId: w.categoryId, amount: w.amount, importId, createdAt: now, updatedAt: now,
        });
      }
    }
    for (const r of plan.rules) {
      await tx.insert(operatingCostImportRules).values({ id: randomUUID(), ...r, createdAt: now, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { lineName: r.lineName, action: r.action, categoryId: r.categoryId, updatedAt: now } });
    }
    await tx.insert(operatingCostImports).values({
      id: importId, year: input.year, month: month0, fileName: input.fileName.slice(0, 191),
      provider: input.provider, model: input.model, instructionsVersion: input.instructionsVersion,
      importedByUserId: who.id, importedByName: me?.name || who.email,
      recordedCount: plan.writes.length, recordedTotal, notImported: plan.notImported, createdAt: now,
    });
  });
  return { importId, recordedCount: plan.writes.length, recordedTotal, notImportedCount: plan.notImported.length };
}

/** Imports for a month whose "not imported" list hasn't been dismissed — newest first. `month` is 0-11. */
export async function openNotices(year: number, month: number) {
  return db.select({
    id: operatingCostImports.id, fileName: operatingCostImports.fileName, importedByName: operatingCostImports.importedByName,
    createdAt: operatingCostImports.createdAt, recordedCount: operatingCostImports.recordedCount,
    recordedTotal: operatingCostImports.recordedTotal, notImported: operatingCostImports.notImported,
  }).from(operatingCostImports)
    .where(and(eq(operatingCostImports.year, year), eq(operatingCostImports.month, month), isNull(operatingCostImports.dismissedAt)))
    .orderBy(desc(operatingCostImports.createdAt));
}

/** Hides an import's "not imported" list. False if there's no such import. */
export async function dismissNotice(id: string): Promise<boolean> {
  const [row] = await db.select({ id: operatingCostImports.id }).from(operatingCostImports).where(eq(operatingCostImports.id, id));
  if (!row) return false;
  await db.update(operatingCostImports).set({ dismissedAt: new Date() }).where(eq(operatingCostImports.id, id));
  return true;
}

/** Puts the default "always skip" rules in place (payroll lines), keeping any choice already made. Run at startup. */
export async function ensureDefaultImportRules(): Promise<void> {
  const keys = DEFAULT_SKIP_LINES.map(normaliseLineName);
  const have = new Set((await db.select({ lineKey: operatingCostImportRules.lineKey }).from(operatingCostImportRules)
    .where(inArray(operatingCostImportRules.lineKey, keys))).map(r => r.lineKey));
  const now = new Date();
  for (const name of DEFAULT_SKIP_LINES) {
    if (have.has(normaliseLineName(name))) continue;
    await db.insert(operatingCostImportRules).values({
      id: randomUUID(), lineKey: normaliseLineName(name), lineName: name, action: 'SKIP', categoryId: null, createdAt: now, updatedAt: now,
    });
  }
}

/** How many past imports the history shows. */
export const HISTORY_LIMIT = 200;

/** Every P&L import, newest first — Operating Costs → Import history. `month` is 0-11. */
export async function importHistory() {
  return db.select({
    id: operatingCostImports.id, year: operatingCostImports.year, month: operatingCostImports.month,
    fileName: operatingCostImports.fileName, provider: operatingCostImports.provider, model: operatingCostImports.model,
    importedByName: operatingCostImports.importedByName, createdAt: operatingCostImports.createdAt,
    recordedCount: operatingCostImports.recordedCount, recordedTotal: operatingCostImports.recordedTotal,
    notImported: operatingCostImports.notImported, dismissedAt: operatingCostImports.dismissedAt,
  }).from(operatingCostImports).orderBy(desc(operatingCostImports.createdAt)).limit(HISTORY_LIMIT);
}

/** What to do when the category already has an amount for that month. */
export type ExistingChoice = 'replace' | 'add';

export interface RecordLineInput {
  /** The line's position in the import's not-imported list, and its name (to be sure it's the same line). */
  index: number;
  name: string;
  categoryId: string;
  /** Needed only when the month already has an amount in that category. */
  existing?: ExistingChoice;
  /** Also save a rule, so the next import records this line by itself. */
  remember?: boolean;
}

export type RecordLineResult =
  | { ok: true }
  /** The category already has an amount that month — ask: replace it, or add to it? */
  | { ok: false; existingAmount: number };

/**
 * Records one line an import left out: writes its amount into the chosen
 * category for that month (marked as from the P&L), takes it off the
 * not-imported list and counts it as recorded. Never overwrites an existing
 * amount unless told to replace or add.
 */
export async function recordNotImportedLine(importId: string, input: RecordLineInput): Promise<RecordLineResult> {
  const [imp] = await db.select().from(operatingCostImports).where(eq(operatingCostImports.id, importId));
  if (!imp) throw new ImportProblem(404, 'Import not found');
  const line = imp.notImported[input.index];
  if (!line || line.name !== input.name) throw new ImportProblem(409, 'That line has already been recorded or changed. Refresh and try again.');
  const [cat] = await db.select({ id: operatingCostCategories.id }).from(operatingCostCategories).where(eq(operatingCostCategories.id, input.categoryId));
  if (!cat) throw new ImportProblem(400, 'That category no longer exists.');
  if (line.amount < 0) throw new ImportProblem(400, 'A credit can’t be recorded here — enter it by hand.');

  const [entry] = await db.select().from(operatingCosts).where(and(
    eq(operatingCosts.year, imp.year), eq(operatingCosts.month, imp.month), eq(operatingCosts.categoryId, input.categoryId)));
  const hasAmount = !!entry && Math.abs(entry.amount) >= 0.005;
  if (hasAmount && !input.existing) return { ok: false, existingAmount: entry!.amount };
  const amount = Math.round(((hasAmount && input.existing === 'add' ? entry!.amount : 0) + line.amount) * 100) / 100;

  const now = new Date();
  await db.transaction(async tx => {
    if (entry) {
      await tx.update(operatingCosts).set({ amount, importId, updatedAt: now }).where(eq(operatingCosts.id, entry.id));
    } else {
      await tx.insert(operatingCosts).values({
        id: randomUUID(), year: imp.year, month: imp.month, categoryId: input.categoryId, amount, importId, createdAt: now, updatedAt: now,
      });
    }
    await tx.update(operatingCostImports).set({
      notImported: imp.notImported.filter((_, i) => i !== input.index),
      recordedCount: imp.recordedCount + 1,
      recordedTotal: Math.round((imp.recordedTotal + line.amount) * 100) / 100,
    }).where(eq(operatingCostImports.id, importId));
    if (input.remember) {
      const lineKey = normaliseLineName(line.name);
      await tx.insert(operatingCostImportRules).values({ id: randomUUID(), lineKey, lineName: line.name, action: 'RECORD', categoryId: input.categoryId, createdAt: now, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { lineName: line.name, action: 'RECORD', categoryId: input.categoryId, updatedAt: now } });
    }
  });
  return { ok: true };
}
