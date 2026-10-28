// Turns Vitest's JSON report into a ✅/❌ checklist on the GitHub Actions
// run's Summary page (one row per test, grouped by file), so results are
// visible without expanding the Tests step log.
//
// Usage: node .github/scripts/test-summary.mjs <vitest-json-file>
// Writes to $GITHUB_STEP_SUMMARY (or stdout when run locally).
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

const file = process.argv[2] ?? 'test-results.json';
const out = (md) => (process.env.GITHUB_STEP_SUMMARY
  ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  : process.stdout.write(md));

if (!existsSync(file)) {
  out('## ❌ Tests did not run\n\nAn earlier step (e.g. Type-check) failed, or the test run crashed before reporting — open the failed step above.\n');
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const icon = { passed: '✅', failed: '❌', skipped: '⏭️', pending: '⏭️', todo: '📝' };
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const { numTotalTests: total = 0, numPassedTests: passed = 0, numFailedTests: failed = 0 } = report;
let md = failed > 0
  ? `## ❌ ${failed} of ${total} tests failed\n\n`
  : `## ✅ All ${passed} tests passed\n\n`;

for (const suite of report.testResults ?? []) {
  const path = relative(process.cwd(), suite.name).replace(/\\/g, '/');
  const tests = suite.assertionResults ?? [];
  const bad = tests.filter(t => t.status === 'failed').length;
  md += `### ${bad ? '❌' : '✅'} \`${path}\` — ${tests.length - bad}/${tests.length}\n\n`;
  md += '| | Test | Time |\n|---|---|---|\n';
  for (const t of tests) {
    const name = [...(t.ancestorTitles ?? []), t.title].filter(Boolean).map(esc).join(' › ');
    const ms = t.duration != null ? `${Math.round(t.duration)} ms` : '';
    md += `| ${icon[t.status] ?? '•'} | ${name} | ${ms} |\n`;
  }
  // First line of each failure message, so the reason is on the summary too.
  for (const t of tests.filter(x => x.status === 'failed')) {
    const msg = (t.failureMessages?.[0] ?? '').split('\n')[0];
    if (msg) md += `\n> **${esc(t.title)}** — ${esc(msg)}\n`;
  }
  md += '\n';
}

out(md);
