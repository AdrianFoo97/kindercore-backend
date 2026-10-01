import { Router } from 'express';
import { createBugReport, listBugReports, resolveBugReport } from '../controllers/bug-reports.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const bugReportsRouter = Router();

// Any authenticated user can submit one. Viewing/triaging is gated the
// same way the Tools nav dropdown itself is on the frontend (Navbar.tsx)
// — an AuthRole granted the Tools module, or ADMIN/SUPERADMIN (which
// requireModule already bypasses unconditionally) — not a hard-coded
// literal-ADMIN check, since most of this app's real day-to-day users
// (Principal/Supervisor-tier accounts) are AuthRole-driven, not actual
// ADMIN rows.
bugReportsRouter.post('/bug-reports', authMiddleware, asyncHandler(createBugReport));
bugReportsRouter.get('/bug-reports', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(listBugReports));
bugReportsRouter.post('/bug-reports/:id/resolve', authMiddleware, requireModule(MODULES.TOOLS), asyncHandler(resolveBugReport));
