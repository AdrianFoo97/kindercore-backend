import { Router } from 'express';
import {
  getPackages,
  getPackageYears,
  getPackagesConfig,
  createPackage,
  deletePackage,
  patchPackage,
  patchPackageName,
  upsertPackages,
  updateProgrammes,
  updateAges,
} from '../controllers/packages.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MODULES } from '../constants/authModules.js';

export const packagesRouter = Router();

packagesRouter.get('/', authMiddleware, asyncHandler(getPackages));
packagesRouter.post('/', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(createPackage));
packagesRouter.put('/', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(upsertPackages));
packagesRouter.get('/years', authMiddleware, asyncHandler(getPackageYears));
packagesRouter.get('/config', authMiddleware, asyncHandler(getPackagesConfig));
packagesRouter.put('/programmes', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(updateProgrammes));
packagesRouter.put('/ages', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(updateAges));
packagesRouter.delete('/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(deletePackage));
packagesRouter.patch('/:id', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(patchPackage));
packagesRouter.patch('/:id/name', authMiddleware, requireModule(MODULES.MARKETING), asyncHandler(patchPackageName));
