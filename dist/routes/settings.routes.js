import { Router } from 'express';
import { getSettings, updateSetting } from '../controllers/settings.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
export const settingsRouter = Router();
settingsRouter.get('/', authMiddleware, getSettings);
settingsRouter.patch('/:key', authMiddleware, adminMiddleware, updateSetting);
//# sourceMappingURL=settings.routes.js.map