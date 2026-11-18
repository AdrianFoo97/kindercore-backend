import { describe, it, expect } from 'vitest';
import { ACCESS_FUNCTIONS, ACCESS_FUNCTION_KEYS, BUILT_IN_ROLES, BUILT_IN_ROLE_PREFIX, MODULE_INCLUDES } from '../../constants/accessRoles.js';
import { ALL_MODULE_KEYS } from '../../constants/authModules.js';

describe('Access roles — built-in roles', () => {
  it('grants only modules and functions that exist, each function inside a module the role opens', () => {
    for (const r of BUILT_IN_ROLES) {
      for (const m of r.modules) expect(ALL_MODULE_KEYS).toContain(m);
      for (const f of r.functions) {
        expect(ACCESS_FUNCTION_KEYS).toContain(f);
        expect(r.modules).toContain(ACCESS_FUNCTIONS.find(x => x.key === f)!.module);
      }
    }
  });

  it('gives every built-in role different access — no two roles that only differ by name', () => {
    const shapes = BUILT_IN_ROLES.map(r => `${[...r.modules].sort().join()}|${[...r.functions].sort().join()}`);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('keeps built-in ids unique, marked as built-in and short enough to store', () => {
    const ids = BUILT_IN_ROLES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith(BUILT_IN_ROLE_PREFIX)).toBe(true);
      expect(id.length).toBeLessThanOrEqual(36);
    }
  });

  it('says what every module opens, so a role with no extra functions still shows what it can do', () => {
    for (const m of ALL_MODULE_KEYS) expect(MODULE_INCLUDES[m]?.length ?? 0).toBeGreaterThan(0);
  });
});
