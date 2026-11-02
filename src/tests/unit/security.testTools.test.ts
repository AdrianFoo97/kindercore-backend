import { describe, it, expect, afterEach, vi } from 'vitest';
import { ARCHITECTURE } from '../../architecture/architecture.generated.js';
import { testEnvOnly } from '../../middlewares/testEnv.middleware.js';
import { reqWith, res, nextSpy } from '../integration/http.js';

// Settings → Test has buttons that delete every lead / student / candidate
// and load dummy data. Fine on the test server; on production one mis-click
// by an Admin would wipe real records. These endpoints must only work where
// TEST_RUNNER_ENABLED=true (never set on production).

const TOOL_PATH = /\/(reset|reset-all|seed-dummy)$/;
const toolEndpoints = ARCHITECTURE.routeGroups.flatMap(g => g.endpoints).filter(e => TOOL_PATH.test(e.path));

function callAs(flag: string | undefined) {
  if (flag === undefined) vi.stubEnv('TEST_RUNNER_ENABLED', '');
  else vi.stubEnv('TEST_RUNNER_ENABLED', flag);
  const r = res();
  const next = nextSpy();
  testEnvOnly(reqWith({}), r, next);
  return { allowed: next.called, status: r.statusCode };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('Security — delete-everything and dummy-data tools', () => {
  it('every delete-everything or dummy-data endpoint is limited to the test server', () => {
    expect(toolEndpoints.map(e => `${e.method} ${e.path}`).sort()).toEqual([
      'DELETE /api/leads/reset',
      'DELETE /api/students/reset',
      'POST /api/candidates/reset-all',
      'POST /api/candidates/seed-dummy',
      'POST /api/leads/seed-dummy',
    ]);
    const unguarded = toolEndpoints.filter(e => !e.middleware.includes('testEnvOnly')).map(e => `${e.method} ${e.path}`);
    expect(unguarded, 'Add testEnvOnly to these routes').toEqual([]);
  });

  it('refuses them on production, as if they did not exist', () => {
    expect(callAs(undefined)).toEqual({ allowed: false, status: 404 });
  });

  it('allows them on the test server', () => {
    expect(callAs('true').allowed).toBe(true);
  });

  it('treats any setting other than exactly "true" as production', () => {
    for (const v of ['TRUE', '1', 'yes', 'false']) expect(callAs(v).allowed).toBe(false);
  });
});
