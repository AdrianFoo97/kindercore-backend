import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from '../../db/client.js';
import { getDbSchema, DbSchemaResponse } from '../../controllers/db-schema.controller.js';
import { req, res } from './http.js';

// The real /api/admin/db-schema handler reading the real test database —
// which globalSetup builds from schema.sql, so the expected structure is
// exactly what that file declares.

const schemaSql = readFileSync(resolve(process.cwd(), 'src/tests/integration/schema.sql'), 'utf8');
const declaredTables = [...schemaSql.matchAll(/CREATE TABLE `(\w+)`/g)].map(m => m[1]).sort();

let body: DbSchemaResponse;
beforeAll(async () => {
  const r = res();
  await getDbSchema(req(), r);
  body = r.body;
});
afterAll(async () => {
  await pool.end();
});

describe('Database Design — live schema endpoint', () => {
  it('lists every table in the database', () => {
    expect(body.tables.map(t => t.name).sort()).toEqual(declaredTables);
  });

  it('reports which database it read and when', () => {
    expect(body.database).toMatch(/_test$/);
    expect(Number.isNaN(Date.parse(body.readAt))).toBe(false);
  });

  it('describes each column\'s type, nullability and primary key', () => {
    const user = body.tables.find(t => t.name === 'User')!;
    const id = user.columns.find(c => c.name === 'id')!;
    const teacherId = user.columns.find(c => c.name === 'teacherId')!;
    // Real column type straight from MySQL (the live User.id is varchar(191),
    // even though schema.ts says 36 — this page shows what's actually there).
    expect(id).toMatchObject({ primaryKey: true, nullable: false });
    expect(id.type).toMatch(/^varchar\(\d+\)$/);
    expect(teacherId).toMatchObject({ primaryKey: false, nullable: true });
  });

  it('keeps columns in their defined order', () => {
    const user = body.tables.find(t => t.name === 'User')!;
    expect(user.columns[0].name).toBe('id');
  });

  it('includes the foreign keys MySQL enforces', () => {
    expect(body.relations).toContainEqual({
      fromTable: 'Student', fromColumn: 'packageId', toTable: 'Package', toColumn: 'id', kind: 'foreignKey',
    });
  });

  it('includes links inferred from column names', () => {
    expect(body.relations).toContainEqual({
      fromTable: 'OperatingCost', fromColumn: 'categoryId', toTable: 'OperatingCostCategory', toColumn: 'id', kind: 'inferred',
    });
  });

  it('only links to tables that exist', () => {
    const names = new Set(body.tables.map(t => t.name));
    for (const r of body.relations) {
      expect(names.has(r.fromTable), `${r.fromTable}.${r.fromColumn}`).toBe(true);
      expect(names.has(r.toTable), `${r.fromTable}.${r.fromColumn} → ${r.toTable}`).toBe(true);
    }
  });
});
