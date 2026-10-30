import { Request, Response } from 'express';
import { z } from 'zod';
import { getCurrentRun, isTestRunnerEnabled, listTestFiles, startRun, TestRunState } from '../services/testRunner.service.js';

// Admin → Test Catalog "Run" buttons. TEST ENVIRONMENT ONLY — both
// endpoints answer 404 unless the server has TEST_RUNNER_ENABLED=true, so
// on production the feature doesn't even appear to exist.

export async function getTestRunner(_req: Request, res: Response): Promise<void> {
  if (!isTestRunnerEnabled()) { res.status(404).json({ message: 'Not found' }); return; }
  res.json({ enabled: true, files: listTestFiles(), run: getCurrentRun() });
}

const runSchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('file'), file: z.string().min(1).max(200) }),
  ]),
});

export async function createTestRun(req: Request, res: Response): Promise<void> {
  if (!isTestRunnerEnabled()) { res.status(404).json({ message: 'Not found' }); return; }
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  const result = startRun(parsed.data.scope as TestRunState['scope']);
  if ('message' in result) { res.status(result.status).json({ message: result.message }); return; }
  res.status(202).json(result.run);
}
