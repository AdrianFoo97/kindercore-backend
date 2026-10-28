import { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// GET /api/admin/db-schema — the live structure of whichever database this
// server is connected to, read from MySQL's information_schema. Powers the
// Admin → Database Design page, so each environment (test, production)
// always shows its own current design with no manual update step: a
// migration applied to the test DB shows up there immediately.

export interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue: string | null;
  extra: string;
}

export interface DbRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** 'foreignKey' = enforced by MySQL; 'inferred' = guessed from an `…Id` column name. */
  kind: 'foreignKey' | 'inferred';
}

export interface DbTable {
  name: string;
  approxRows: number;
  columns: DbColumn[];
}

export interface DbSchemaResponse {
  database: string;
  readAt: string;
  tables: DbTable[];
  relations: DbRelation[];
}

/** Longest shared leading run of characters. */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Links whose column name doesn't say where they point. Keyed
 * `Table.column` → target table. Keep this short — prefer naming columns
 * after their target (`xxxId`) so inference finds them on its own.
 */
export const KNOWN_LINKS: Record<string, string> = {
  'RewardRedemption.rewardId': 'PointsRewardItem',
  'TeacherRewardGoal.rewardId': 'PointsRewardItem',
  'AllowanceType.parentId': 'AllowanceType', // sub-type → its parent type
};

export interface SchemaTableShape {
  name: string;
  columns: string[];
  /** Primary-key column(s). */
  primaryKey: string[];
}

/** Picks the table an `…Id` column points at, or null. See inferRelations. */
function resolveTarget(owner: SchemaTableShape, col: string, names: string[]): string | null {
  // "reportedByUser" → ["reported","By","User"]; try "ReportedByUser",
  // then "ByUser", then "User" — longest (most specific) first.
  const words = col.slice(0, -2).split(/(?=[A-Z])/);
  for (let i = 0; i < words.length; i++) {
    const joined = words.slice(i).join('');
    const suffix = joined.charAt(0).toUpperCase() + joined.slice(1);
    if (names.includes(suffix)) return suffix;
    const enders = names.filter(n => n.endsWith(suffix) && n !== owner.name);
    if (enders.length === 1) return enders[0];
    if (enders.length > 1) {
      // Several candidates (SopCategory, OperatingCostCategory…): the one
      // sharing the longest name prefix with the owning table.
      const best = enders
        .map(n => ({ n, p: commonPrefixLength(n, owner.name) }))
        .sort((a, b) => b.p - a.p || a.n.length - b.n.length)[0];
      if (best.p > 0) return best.n;
    }
  }
  return null;
}

/**
 * Most of this schema links tables with plain `xxxId` columns rather than
 * declared foreign keys, so derive those links from naming:
 *   `teacherId` → `Teacher`;  `reportedByUserId` → `User`;
 *   `categoryId` on `OperatingCost` → `OperatingCostCategory` (not
 *   `SopCategory` — the longest shared name prefix wins).
 * Skipped: columns already covered by a real foreign key; a table's own
 * key named after itself (`Department.departmentId`); and `…Id` columns
 * matching no table (external ids like googleEventId).
 * The target column is the target table's primary key (Position's is
 * `positionId`, most others `id`).
 */
export function inferRelations(
  tables: SchemaTableShape[],
  foreignKeys: Pick<DbRelation, 'fromTable' | 'fromColumn'>[],
): DbRelation[] {
  const names = tables.map(t => t.name);
  const pkOf = (name: string) => tables.find(t => t.name === name)?.primaryKey[0] ?? 'id';
  const hasFk = new Set(foreignKeys.map(f => `${f.fromTable}.${f.fromColumn}`));
  const out: DbRelation[] = [];
  for (const t of tables) {
    for (const col of t.columns) {
      const key = `${t.name}.${col}`;
      if (hasFk.has(key)) continue;
      const target = KNOWN_LINKS[key]
        ?? (col !== 'id' && col.endsWith('Id') ? resolveTarget(t, col, names) : null);
      if (!target) continue;
      // A table's own key named after itself isn't a link.
      if (target === t.name && t.primaryKey.includes(col) && !KNOWN_LINKS[key]) continue;
      out.push({ fromTable: t.name, fromColumn: col, toTable: target, toColumn: pkOf(target), kind: 'inferred' });
    }
  }
  return out;
}

type Row = Record<string, any>;
const rowsOf = (result: unknown): Row[] => (result as [Row[]])[0];

export async function getDbSchema(_req: Request, res: Response): Promise<void> {
  const [dbRow] = rowsOf(await db.execute(sql`SELECT DATABASE() AS name`));
  const schema = dbRow.name as string;

  const tableRows = rowsOf(await db.execute(sql`
    SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${schema} AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME`));

  const columnRows = rowsOf(await db.execute(sql`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type,
           IS_NULLABLE AS nullable, COLUMN_KEY AS colKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ${schema}
    ORDER BY TABLE_NAME, ORDINAL_POSITION`));

  // Single-column unique indexes (multi-column ones aren't "this column is unique").
  const uniqueRows = rowsOf(await db.execute(sql`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ${schema} AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
      AND (TABLE_NAME, INDEX_NAME) IN (
        SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ${schema} GROUP BY TABLE_NAME, INDEX_NAME HAVING COUNT(*) = 1)`));
  const uniqueSet = new Set(uniqueRows.map(r => `${r.tableName}.${r.name}`));

  const fkRows = rowsOf(await db.execute(sql`
    SELECT TABLE_NAME AS fromTable, COLUMN_NAME AS fromColumn,
           REFERENCED_TABLE_NAME AS toTable, REFERENCED_COLUMN_NAME AS toColumn
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = ${schema} AND REFERENCED_TABLE_NAME IS NOT NULL`));

  const tables: DbTable[] = tableRows.map(t => ({
    name: t.name,
    approxRows: Number(t.approxRows ?? 0),
    columns: columnRows.filter(c => c.tableName === t.name).map(c => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable === 'YES',
      primaryKey: c.colKey === 'PRI',
      unique: uniqueSet.has(`${c.tableName}.${c.name}`),
      defaultValue: c.defaultValue,
      extra: c.extra ?? '',
    })),
  }));

  const foreignKeys: DbRelation[] = fkRows.map(f => ({ ...f, kind: 'foreignKey' } as DbRelation));
  const relations = [
    ...foreignKeys,
    ...inferRelations(tables.map(t => ({
      name: t.name,
      columns: t.columns.map(c => c.name),
      primaryKey: t.columns.filter(c => c.primaryKey).map(c => c.name),
    })), foreignKeys),
  ];

  const body: DbSchemaResponse = { database: schema, readAt: new Date().toISOString(), tables, relations };
  res.json(body);
}
