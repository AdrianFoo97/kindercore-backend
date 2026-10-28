import { sql } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { getTableConfig } from 'drizzle-orm/mysql-core';

// Local default = the docker-compose MySQL (host port 3307), in a separate
// `kindercore_test` database so the dev data is never touched. CI sets
// TEST_DATABASE_URL to its own throwaway MySQL service.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3307/kindercore_test';

/** Hard stop before anything destructive: only a database whose name ends
 *  in `_test` may be dropped or truncated by the test suite. */
export function assertTestDatabase(name: string) {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${name}" — test databases must end in "_test".`);
  }
}

/** Empties the given tables (in the test database) so each test starts from
 *  only the fixtures it loads itself. */
export async function resetTables(...tables: MySqlTable[]) {
  const { db } = await import('../../db/client.js');
  const [rows] = await db.execute(sql`SELECT DATABASE() AS name`) as unknown as [{ name: string }[]];
  assertTestDatabase(rows[0].name);
  for (const t of tables) {
    await db.execute(sql.raw(`DELETE FROM \`${getTableConfig(t).name}\``));
  }
}
