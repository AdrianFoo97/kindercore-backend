import { Router } from 'express';
import {
  listAuthRoles, createAuthRole, updateAuthRole, deleteAuthRole,
  setAuthRoleModules, setAuthRoleViews, listAuthCatalog,
} from '../controllers/auth-roles.controller.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRolesRouter = Router();

// Anyone authenticated can read the list (so a non-admin's own AuthRole
// name/description can be shown in UI) — only ADMIN/SUPERADMIN can create,
// edit, delete, or change what a role grants.
authRolesRouter.get('/auth-roles', authMiddleware, asyncHandler(listAuthRoles));
authRolesRouter.get('/auth-roles/catalog', authMiddleware, asyncHandler(listAuthCatalog));
authRolesRouter.post('/auth-roles', authMiddleware, adminMiddleware, asyncHandler(createAuthRole));
authRolesRouter.patch('/auth-roles/:id', authMiddleware, adminMiddleware, asyncHandler(updateAuthRole));
authRolesRouter.delete('/auth-roles/:id', authMiddleware, adminMiddleware, asyncHandler(deleteAuthRole));
authRolesRouter.put('/auth-roles/:id/modules', authMiddleware, adminMiddleware, asyncHandler(setAuthRoleModules));
authRolesRouter.put('/auth-roles/:id/views', authMiddleware, adminMiddleware, asyncHandler(setAuthRoleViews));
