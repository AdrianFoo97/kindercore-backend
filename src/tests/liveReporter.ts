import type { Reporter, File, Task, TaskResultPack } from 'vitest';
import { relative } from 'node:path';

// Vitest reporter for the Test Catalog's "Run" buttons: prints one line per
// test state change as it happens —
//   KC_EVENT {"file":"src/tests/unit/x.test.ts","name":"…","state":"pending|running|passed|failed|skipped","ms":12}
// — so the page can show each test going pending → running → passed/failed
// individually, rather than a whole file at a time. Only used by
// testRunner.service.ts; normal `npm test` runs don't load it.

type State = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export default class LiveReporter implements Reporter {
  private tests = new Map<string, { file: string; name: string }>();

  private emit(id: string, state: State, ms?: number) {
    const t = this.tests.get(id);
    if (!t) return;
    process.stdout.write(`KC_EVENT ${JSON.stringify({ ...t, state, ...(ms !== undefined ? { ms: Math.round(ms) } : {}) })}\n`);
  }

  onCollected(files?: File[]) {
    const walk = (task: Task, file: string) => {
      if (task.type === 'test') {
        this.tests.set(task.id, { file, name: task.name });
        if (task.mode === 'skip' || task.mode === 'todo') this.emit(task.id, 'skipped');
        else this.emit(task.id, 'pending');
      }
      if ('tasks' in task) for (const child of task.tasks) walk(child, file);
    };
    for (const f of files ?? []) {
      const file = relative(process.cwd(), f.filepath).replace(/\\/g, '/');
      for (const t of f.tasks) walk(t, file);
    }
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    for (const [id, result] of packs) {
      if (!result || !this.tests.has(id)) continue;
      const s = result.state;
      if (s === 'run') this.emit(id, 'running');
      else if (s === 'pass') this.emit(id, 'passed', result.duration);
      else if (s === 'fail') this.emit(id, 'failed', result.duration);
      else if (s === 'skip' || s === 'todo') this.emit(id, 'skipped');
    }
  }
}
