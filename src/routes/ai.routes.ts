import { Router } from 'express';
import { comparePnlReading, deleteAiKey, getAiModels, getAiSettings, putAiCommon, putAiFeature, putAiKey, testAiProvider } from '../controllers/ai.controller.js';
import { pdfUpload } from '../controllers/operatingCostImport.controller.js';
import { testEnvOnly } from '../middlewares/testEnv.middleware.js';
import { adminMiddleware, authMiddleware, requireAnyModule } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { aiRequestLimit } from '../middlewares/aiLimit.middleware.js';
import { rewriteMessageHandler } from '../controllers/messageRewrite.controller.js';
import { MODULES } from '../constants/authModules.js';

// Settings → AI (admins). Shared by every AI feature; keys are write-only.
export const aiRouter = Router();

aiRouter.get('/settings', authMiddleware, adminMiddleware, asyncHandler(getAiSettings));
aiRouter.put('/settings', authMiddleware, adminMiddleware, asyncHandler(putAiCommon));
aiRouter.put('/features/:key', authMiddleware, adminMiddleware, asyncHandler(putAiFeature));
aiRouter.put('/keys/:provider', authMiddleware, adminMiddleware, asyncHandler(putAiKey));
aiRouter.delete('/keys/:provider', authMiddleware, adminMiddleware, asyncHandler(deleteAiKey));
aiRouter.post('/test', authMiddleware, adminMiddleware, asyncHandler(testAiProvider));
aiRouter.get('/models/:provider', authMiddleware, adminMiddleware, asyncHandler(getAiModels));
// Test site only (404 elsewhere): read one P&L with every provider, side by side. Imports nothing.
aiRouter.post('/compare/pnl-reading', authMiddleware, adminMiddleware, testEnvOnly, aiRequestLimit, pdfUpload, asyncHandler(comparePnlReading));
// Message templates (Marketing; applicant templates: HR) → Rewrite with AI. A suggestion only.
aiRouter.post('/rewrite-message', authMiddleware, requireAnyModule(MODULES.MARKETING, MODULES.HR), aiRequestLimit, asyncHandler(rewriteMessageHandler));
