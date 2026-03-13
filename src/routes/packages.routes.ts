import { Router } from 'express';
import {
  getPackages,
  getPackageYears,
  getPackagesConfig,
  createPackage,
  deletePackage,
  patchPackageName,
  upsertPackages,
  updateProgrammes,
  updateAges,
} from '../controllers/packages.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const packagesRouter = Router();

packagesRouter.get('/', authMiddleware, asyncHandler(getPackages));
packagesRouter.post('/', authMiddleware, adminMiddleware, asyncHandler(createPackage));
packagesRouter.put('/', authMiddleware, adminMiddleware, asyncHandler(upsertPackages));
packagesRouter.get('/years', authMiddleware, asyncHandler(getPackageYears));
packagesRouter.get('/config', authMiddleware, asyncHandler(getPackagesConfig));
packagesRouter.put('/programmes', authMiddleware, adminMiddleware, asyncHandler(updateProgrammes));
packagesRouter.put('/ages', authMiddleware, adminMiddleware, asyncHandler(updateAges));
packagesRouter.delete('/:id', authMiddleware, adminMiddleware, asyncHandler(deletePackage));
packagesRouter.patch('/:id/name', authMiddleware, adminMiddleware, asyncHandler(patchPackageName));
