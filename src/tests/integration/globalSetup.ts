import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { TEST_DATABASE_URL, assertTestDatabase } from './testDb.js';

// Runs once before the whole test run: drops and recreates the test
// database from schema.sql (a structure-only dump of the real schema), so
// every run starts from the same empty tables. Each test then loads only
// the fixtures it needs.
//
// Refresh schema.sql after a migration:
//   docker exec kindercoreproject-db-1 mysqldump -uroot -proot --no-data \
//     --skip-comments --skip-add-drop-table --no-tablespaces kindercore \
//     | sed 's/ AUTO_INCREMENT=[0-9]*//' > src/tests/integration/schema.sql
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  assertTestDatabase(dbName);

  url.pathname = '/';
  const conn = await mysql.createConnection({ uri: url.toString(), multipleStatements: true });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${dbName}\``);
    // Vitest runs from the package root.
    const schema = readFileSync(resolve(process.cwd(), 'src/tests/integration/schema.sql'), 'utf8');
    await conn.query(schema);
  } finally {
    await conn.end();
  }
}
