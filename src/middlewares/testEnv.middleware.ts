import { Request, Response, NextFunction } from 'express';
import { isTestRunnerEnabled } from '../services/testRunner.service.js';

// Test-environment-only endpoints (Settings → Test: delete every lead /
// student / candidate, load dummy data). Same switch as the Test Catalog
// runner — TEST_RUNNER_ENABLED=true, which production never sets — so on
// production these answer 404 and an Admin can't wipe live data by mistake.
export function testEnvOnly(_req: Request, res: Response, next: NextFunction): void {
  if (!isTestRunnerEnabled()) { res.status(404).json({ message: 'Not found' }); return; }
  next();
}
