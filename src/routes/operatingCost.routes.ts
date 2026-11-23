import { Router } from 'express';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  listCategories, createCategory, updateCategory, deleteCategory,
  getEntries, bulkUpsertEntries,
} from '../controllers/operatingCost.controller.js';
import {
  applyImportHandler, dismissImportNotice, getImportHistory, getImportStatus, listImportNotices, pdfUpload, readImport, recordNoticeLine,
} from '../controllers/operatingCostImport.controller.js';
import { getImportRules, postImportRule, putImportRule, removeImportRule } from '../controllers/pnlImportRules.controller.js';
import { authMiddleware, requireModule, requireAnyModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logSensitiveAccess } from '../middlewares/accessLog.middleware.js';
import { aiRequestLimit } from '../middlewares/aiLimit.middleware.js';

export const operatingCostRouter = Router();

operatingCostRouter.get('/groups', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(listGroups));
operatingCostRouter.post('/groups', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(createGroup));
operatingCostRouter.put('/groups/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(updateGroup));
operatingCostRouter.delete('/groups/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(deleteGroup));

operatingCostRouter.get('/categories', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(listCategories));
operatingCostRouter.post('/categories', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(createCategory));
operatingCostRouter.put('/categories/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(updateCategory));
operatingCostRouter.delete('/categories/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(deleteCategory));

operatingCostRouter.get('/entries', authMiddleware, requireAnyModule(MODULES.FINANCE, MODULES.ANALYSIS), asyncHandler(getEntries));
operatingCostRouter.put('/entries', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(bulkUpsertEntries));

// Import P&L (Finance): read = preview only, apply = write; notices = what an import left out.
operatingCostRouter.get('/import/status', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(getImportStatus));
// A P&L holds revenue and salaries, so reading one is logged like other finance reads.
operatingCostRouter.post('/import/read', authMiddleware, requireModule(MODULES.FINANCE), aiRequestLimit, pdfUpload, logSensitiveAccess('FINANCE'), asyncHandler(readImport));
operatingCostRouter.post('/import/apply', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(applyImportHandler));
operatingCostRouter.get('/import/notices', authMiddleware, requireModule(MODULES.FINANCE), logSensitiveAccess('FINANCE'), asyncHandler(listImportNotices));
operatingCostRouter.post('/import/notices/:id/dismiss', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(dismissImportNotice));
operatingCostRouter.post('/import/notices/:id/record', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(recordNoticeLine));
operatingCostRouter.get('/import/history', authMiddleware, requireModule(MODULES.FINANCE), logSensitiveAccess('FINANCE'), asyncHandler(getImportHistory));

// Settings → Operating cost → Import rules (admins). The AI itself: Settings → AI (ai.routes).
operatingCostRouter.get('/import/rules', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(getImportRules));
operatingCostRouter.post('/import/rules', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(postImportRule));
operatingCostRouter.put('/import/rules/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(putImportRule));
operatingCostRouter.delete('/import/rules/:id', authMiddleware, requireModule(MODULES.FINANCE), asyncHandler(removeImportRule));
