import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// The pool maths lives in two places: the server (what each teacher is sent,
// services/poolMath.service.ts) and the admin Analysis pages' browser copy
// (kindercore-frontend/src/utils/poolMath.ts, for the interactive "leave a
// teacher out" split). This guard fails if the two ever differ, so a teacher's
// share can't drift from what the admin page pays out. Skipped where the
// frontend source isn't present (e.g. the test server).

// Tests run from the kindercore-backend folder.
const SERVER = path.resolve('src/services/poolMath.service.ts');
const FRONTEND = path.resolve('../kindercore-frontend/src/utils/poolMath.ts');
const SETTINGS_PAGE = path.resolve('../kindercore-frontend/src/pages/FinanceSettingsPage.tsx');
const POOL_FUNCTIONS = ['settingNum', 'monthPool', 'poolWeight', 'splitPool'];
const DEFAULTS = ['DEFAULT_EXPENSE_RATIO_TARGET', 'DEFAULT_PROFIT_SHARE_PERCENT', 'DEFAULT_ANNUAL_BONUS_PERCENT'];

/** A top-level function's code, from "export function name" to its closing brace at column 0 — whitespace-insensitive. */
function functionCode(source: string, name: string): string | null {
  const start = source.indexOf(`export function ${name}`);
  if (start === -1) return null;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2).replace(/\s+/g, ' ');
}
const constant = (source: string, name: string) => source.match(new RegExp(`export const ${name} = ([0-9.]+)`))?.[1] ?? null;

describe.skipIf(!existsSync(FRONTEND))('Pools — the server and the admin pages use identical maths', () => {
  it('has the same month, weight, split and setting rules in the server and the admin pages', () => {
    const server = readFileSync(SERVER, 'utf8');
    const frontend = readFileSync(FRONTEND, 'utf8');
    for (const name of POOL_FUNCTIONS) {
      expect(functionCode(server, name), `${name} is missing on the server`).not.toBeNull();
      expect(functionCode(frontend, name), `${name} differs between server and admin pages`).toBe(functionCode(server, name));
    }
  });

  it('falls back to the same default percentages as the Finance settings page', () => {
    const server = readFileSync(SERVER, 'utf8');
    const settings = readFileSync(SETTINGS_PAGE, 'utf8');
    for (const name of DEFAULTS) expect(constant(settings, name), name).toBe(constant(server, name));
  });
});
