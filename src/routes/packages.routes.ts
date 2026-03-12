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

export const packagesRouter = Router();

packagesRouter.get('/', authMiddleware, getPackages);
packagesRouter.post('/', authMiddleware, adminMiddleware, createPackage);
packagesRouter.put('/', authMiddleware, adminMiddleware, upsertPackages);
packagesRouter.get('/years', authMiddleware, getPackageYears);
packagesRouter.get('/config', authMiddleware, getPackagesConfig);
packagesRouter.put('/programmes', authMiddleware, adminMiddleware, updateProgrammes);
packagesRouter.put('/ages', authMiddleware, adminMiddleware, updateAges);
packagesRouter.delete('/:id', authMiddleware, adminMiddleware, deletePackage);
packagesRouter.patch('/:id/name', authMiddleware, adminMiddleware, patchPackageName);
