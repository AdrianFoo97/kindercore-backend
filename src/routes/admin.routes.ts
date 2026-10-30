import { Router } from 'express';
import { runYearRollover, undoYearRollover, repairRollover } from '../controllers/admin.controller.js';
import { getDbSchema } from '../controllers/db-schema.controller.js';
import { getArchitecture } from '../controllers/architecture.controller.js';
import { getReaderKey, createReaderKey, deleteReaderKey } from '../controllers/attendance-reader.controller.js';
import { getTestRunner, createTestRun } from '../controllers/test-runner.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Admin-only operations (data migrations, year rollover, etc.)
export const adminRouter = Router();

adminRouter.post('/year-rollover', authMiddleware, adminMiddleware, asyncHandler(runYearRollover));
adminRouter.post('/year-rollover/undo', authMiddleware, adminMiddleware, asyncHandler(undoYearRollover));
adminRouter.post('/year-rollover/repair', authMiddleware, adminMiddleware, asyncHandler(repairRollover));

// Live database structure for the Admin → Database Design page (read-only).
adminRouter.get('/db-schema', authMiddleware, adminMiddleware, asyncHandler(getDbSchema));

// Backend layered structure for the Admin → Backend Architecture page (read-only).
adminRouter.get('/architecture', authMiddleware, adminMiddleware, asyncHandler(getArchitecture));

// Attendance reader key (Settings → Attendance Reader). Generate returns the
// plain key once; only a hash is stored.
adminRouter.get('/attendance-reader', authMiddleware, adminMiddleware, asyncHandler(getReaderKey));
adminRouter.post('/attendance-reader/key', authMiddleware, adminMiddleware, asyncHandler(createReaderKey));
adminRouter.delete('/attendance-reader/key', authMiddleware, adminMiddleware, asyncHandler(deleteReaderKey));

// Test Catalog "Run" buttons — TEST ENVIRONMENT ONLY (404 unless
// TEST_RUNNER_ENABLED=true on the server).
adminRouter.get('/test-runner', authMiddleware, adminMiddleware, asyncHandler(getTestRunner));
adminRouter.post('/test-runner/runs', authMiddleware, adminMiddleware, asyncHandler(createTestRun));
