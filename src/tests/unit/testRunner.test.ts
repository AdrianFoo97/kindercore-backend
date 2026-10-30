import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isTestRunnerEnabled, listTestFiles, parseEventLine, startRun, testDatabaseUrl,
} from '../../services/testRunner.service.js';

// The Test Catalog's "Run" buttons. It must be impossible to use outside a
// test environment, refuse anything but a real test file, never touch a
// database that isn't a *_test one, and read live results correctly.
// None of these cases actually start a test run.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Test runner — only in a test environment', () => {
  it('is off unless the server explicitly enables it', () => {
    vi.stubEnv('TEST_RUNNER_ENABLED', '');
    expect(isTestRunnerEnabled()).toBe(false);
    vi.stubEnv('TEST_RUNNER_ENABLED', '1');
    expect(isTestRunnerEnabled()).toBe(false); // only the exact value "true" turns it on
  });

  it('refuses to start a run when it is off', () => {
    vi.stubEnv('TEST_RUNNER_ENABLED', '');
    expect(startRun({ kind: 'all' })).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a file that is not one of the test files', () => {
    vi.stubEnv('TEST_RUNNER_ENABLED', 'true');
    expect(startRun({ kind: 'file', file: '../../etc/passwd' })).toMatchObject({ ok: false, status: 400 });
    expect(startRun({ kind: 'file', file: 'src/server.ts' })).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses to run against a database that is not a *_test one', () => {
    vi.stubEnv('TEST_RUNNER_ENABLED', 'true');
    vi.stubEnv('TEST_DATABASE_URL', 'mysql://root:root@db:3306/kindercore');
    const r = startRun({ kind: 'file', file: listTestFiles()[0] });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('derives the test database from the app\'s own by adding _test', () => {
    vi.stubEnv('TEST_DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL', 'mysql://root:pw@db:3306/kindercore');
    expect(new URL(testDatabaseUrl()!).pathname).toBe('/kindercore_test');
  });

  it('lists the real backend test files', () => {
    const files = listTestFiles();
    expect(files).toContain('src/tests/unit/testRunner.test.ts');
    expect(files.every(f => /^src\/tests\/(unit|integration)\/[\w.-]+\.test\.ts$/.test(f))).toBe(true);
  });
});

describe('Test runner — reading live results', () => {
  const ev = (o: object) => `KC_EVENT ${JSON.stringify(o)}`;

  it('reads a test starting, so the page can show it running', () => {
    expect(parseEventLine(ev({ file: 'src/tests/unit/lead.test.ts', name: 'accepts a valid lead submission', state: 'running' })))
      .toEqual({ file: 'src/tests/unit/lead.test.ts', name: 'accepts a valid lead submission', status: 'running' });
  });

  it('reads a finished test with how long it took', () => {
    expect(parseEventLine(ev({ file: 'src/tests/unit/a.test.ts', name: 'works', state: 'passed', ms: 12 })))
      .toMatchObject({ status: 'passed', ms: 12 });
    expect(parseEventLine(ev({ file: 'src/tests/unit/a.test.ts', name: 'breaks', state: 'failed', ms: 40 }))?.status).toBe('failed');
  });

  it('ignores anything that is not a valid test event', () => {
    expect(parseEventLine(' Test Files  4 passed (4)')).toBeNull();
    expect(parseEventLine('KC_EVENT {not json')).toBeNull();
    expect(parseEventLine(ev({ file: 'x.test.ts', name: 'n', state: 'exploded' }))).toBeNull();
  });
});
