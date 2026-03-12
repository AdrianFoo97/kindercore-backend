import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { leadsRouter } from './leads.routes.js';
import { googleRouter } from './google.routes.js';
import { settingsRouter } from './settings.routes.js';
import { packagesRouter } from './packages.routes.js';
import { studentsRouter } from './students.routes.js';
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
//# sourceMappingURL=index.js.map