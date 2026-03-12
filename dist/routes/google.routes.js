import { Router } from 'express';
import { getStatus, connectToken, startAuth, handleCallback, } from '../controllers/google.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
export const googleRouter = Router();
googleRouter.get('/status', authMiddleware, getStatus);
googleRouter.post('/connect-token', authMiddleware, connectToken);
googleRouter.get('/auth', startAuth);
googleRouter.get('/callback', handleCallback);
//# sourceMappingURL=google.routes.js.map