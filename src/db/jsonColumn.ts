import { customType } from 'drizzle-orm/mysql-core';

/**
 * Read a JSON column's text back into its value. Some MySQL-compatible servers
 * (e.g. MariaDB, where JSON is LONGTEXT) hand JSON columns back as text; MySQL's
 * driver hands back the value. Drizzle's own `json` doesn't parse on read, so
 * code written against MySQL would get a string in production. Text that isn't
 * JSON is returned as it is.
 */
export function fromJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * A JSON column that reads the same on every server — for columns holding
 * objects or lists (never a bare string, so text always means "parse me").
 */
export const jsonColumn = customType<{ data: unknown; driverData: unknown }>({
  dataType() { return 'json'; },
  toDriver(value) { return JSON.stringify(value); },
  fromDriver(value) { return fromJsonColumn(value); },
});
