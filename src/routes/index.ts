import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { leadsRouter } from './leads.routes.js';
import { googleRouter } from './google.routes.js';
import { settingsRouter } from './settings.routes.js';
import { packagesRouter } from './packages.routes.js';
import { studentsRouter } from './students.routes.js';
import { plannerRouter } from './planner.routes.js';
import { salaryRouter } from './salary.routes.js';
import { careerRouter } from './career.routes.js';
import { allowanceRouter } from './allowance.routes.js';
import { financeRouter } from './finance.routes.js';
import { operatingCostRouter } from './operatingCost.routes.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/leads', leadsRouter);
router.use('/google', googleRouter);
router.use('/settings', settingsRouter);
router.use('/packages', packagesRouter);
router.use('/students', studentsRouter);
router.use('/planner', plannerRouter);
router.use('/salary', salaryRouter);
router.use('/finance', financeRouter);
router.use('/operating-cost', operatingCostRouter);
router.use('/', careerRouter);
router.use('/', allowanceRouter);
