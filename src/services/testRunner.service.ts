import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Runs the backend's own Vitest suite on demand, for Admin → Test Catalog's
// "Run" buttons. TEST ENVIRONMENT ONLY: everything here is inert unless the
// server has TEST_RUNNER_ENABLED=true (set only on the test server — never
// production). Integration tests rebuild and use a separate `*_test`
// database, never the live one; the runner refuses to start otherwise.
//
// One run at a time. Live per-test status comes from our own reporter
// (src/tests/liveReporter.ts), which prints a KC_EVENT line each time a
// test is collected, starts, passes or fails; the final pass/fail + failure
// messages come from Vitest's JSON report when the run ends.

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestRunState {
  id: string;
  /** What was run: everything, or one whole test file (single tests on their own aren't offered). */
  scope: { kind: 'all' } | { kind: 'file'; file: string };
  status: 'running' | 'passed' | 'failed' | 'error';
  startedAt: string;
  finishedAt: string | null;
  /** Keyed `${file}::${testName}` (file relative to the backend root, e.g. src/tests/unit/lead.test.ts). */
  results: Record<string, TestStatus>;
  /** How long each finished test took, in ms, same keys. */
  durations: Record<string, number>;
  /** First lines of each failure, same keys. */
  failures: Record<string, string>;
  /** Files currently executing. */
  runningFiles: string[];
  totals: { passed: number; failed: number; skipped: number };
  /** Set when the run itself broke (couldn't start, timed out, crashed). */
  error: string | null;
}

const ROOT = process.cwd();
const TEST_DIRS = ['src/tests/unit', 'src/tests/integration'];
const MAX_RUN_MS = 5 * 60 * 1000;

let current: TestRunState | null = null;
let child: ChildProcess | null = null;

export function isTestRunnerEnabled(): boolean {
  return process.env.TEST_RUNNER_ENABLED === 'true';
}

/** Every backend test file, relative to the backend root. */
export function listTestFiles(): string[] {
  return TEST_DIRS.flatMap(d => {
    const abs = join(ROOT, d);
    return existsSync(abs) ? readdirSync(abs).filter(f => f.endsWith('.test.ts')).map(f => `${d}/${f}`) : [];
  }).sort();
}

/** The `_test` database the run will use — explicit, or the app's DB name + `_test`. */
export function testDatabaseUrl(): string | null {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) return null;
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `/${u.pathname.replace(/^\//, '')}_test`;
  return u.toString();
}

export function getCurrentRun(): TestRunState | null {
  return current;
}

const toRel = (p: string) => relative(ROOT, resolve(ROOT, p)).replace(/\\/g, '/');

/**
 * Parse one live event line from src/tests/liveReporter.ts, e.g.
 *   KC_EVENT {"file":"src/tests/unit/lead.test.ts","name":"accepts a valid lead submission","state":"passed","ms":3}
 */
export function parseEventLine(line: string): { file: string; name: string; status: TestStatus; ms?: number } | null {
  const i = line.indexOf('KC_EVENT ');
  if (i < 0) return null;
  try {
    const e = JSON.parse(line.slice(i + 9));
    const ok = ['pending', 'running', 'passed', 'failed', 'skipped'].includes(e.state);
    if (!ok || typeof e.file !== 'string' || typeof e.name !== 'string') return null;
    return { file: toRel(e.file), name: e.name, status: e.state, ...(typeof e.ms === 'number' ? { ms: e.ms } : {}) };
  } catch {
    return null;
  }
}

export function startRun(scope: TestRunState['scope']): { ok: true; run: TestRunState } | { ok: false; status: number; message: string } {
  if (!isTestRunnerEnabled()) return { ok: false, status: 404, message: 'Not found' };
  if (current?.status === 'running') return { ok: false, status: 409, message: 'A test run is already in progress' };

  const files = listTestFiles();
  if (scope.kind !== 'all' && !files.includes(scope.file)) return { ok: false, status: 400, message: 'Unknown test file' };

  const dbUrl = testDatabaseUrl();
  if (!dbUrl || !new URL(dbUrl).pathname.replace(/^\//, '').endsWith('_test')) {
    return { ok: false, status: 400, message: 'No *_test database configured — refusing to run tests' };
  }

  const jsonOut = join(tmpdir(), `kc-test-run-${Date.now()}.json`);
  // Arguments array, no shell: the file path is passed verbatim, never interpreted.
  const args = ['vitest', 'run', '--reporter=./src/tests/liveReporter.ts', '--reporter=json', `--outputFile.json=${jsonOut}`];
  if (scope.kind !== 'all') args.push(scope.file);

  const run: TestRunState = {
    id: `run-${Date.now()}`, scope, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    results: {}, durations: {}, failures: {}, runningFiles: scope.kind === 'all' ? [] : [scope.file],
    totals: { passed: 0, failed: 0, skipped: 0 }, error: null,
  };
  current = run;

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  child = spawn(npx, args, {
    cwd: ROOT,
    env: { ...process.env, TEST_DATABASE_URL: dbUrl, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
    shell: false,
  });

  let buf = '';
  const onData = (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const hit = parseEventLine(line);
      if (!hit) continue;
      const key = `${hit.file}::${hit.name}`;
      run.results[key] = hit.status;
      if (hit.ms !== undefined) run.durations[key] = hit.ms;
      if (hit.status === 'running' && !run.runningFiles.includes(hit.file)) run.runningFiles.push(hit.file);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  const timer = setTimeout(() => {
    run.error = 'Timed out after 5 minutes';
    child?.kill();
  }, MAX_RUN_MS);

  child.on('error', err => {
    clearTimeout(timer);
    run.status = 'error';
    run.error = `Could not start the test runner: ${err.message}`;
    run.finishedAt = new Date().toISOString();
    child = null;
  });

  child.on('close', () => {
    clearTimeout(timer);
    try {
      // Authoritative final results (and failure messages) from the JSON report.
      const report = JSON.parse(readFileSync(jsonOut, 'utf8'));
      for (const suite of report.testResults ?? []) {
        const file = toRel(suite.name);
        for (const t of suite.assertionResults ?? []) {
          const key = `${file}::${t.title}`;
          const status: TestStatus = t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : 'skipped';
          run.results[key] = status;
          if (status === 'failed') {
            run.failures[key] = String(t.failureMessages?.[0] ?? 'Failed').split('\n').slice(0, 4).join('\n');
          }
        }
      }
      rmSync(jsonOut, { force: true });
    } catch {
      if (!run.error) run.error = 'The test run ended without a report (it may have crashed before starting)';
    }
    const vals = Object.values(run.results);
    run.totals = {
      passed: vals.filter(v => v === 'passed').length,
      failed: vals.filter(v => v === 'failed').length,
      skipped: vals.filter(v => v === 'skipped').length,
    };
    run.runningFiles = [];
    run.status = run.error ? 'error' : run.totals.failed > 0 ? 'failed' : 'passed';
    run.finishedAt = new Date().toISOString();
    child = null;
  });

  return { ok: true, run };
}
