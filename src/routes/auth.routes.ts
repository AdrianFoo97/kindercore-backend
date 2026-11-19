import { Router } from 'express';
import { login, logout, createInvite, verifyInvite, activateAccount, listUsers, deleteUser, updateUserTeacher, setUserAuthRoles } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(login));
authRouter.post('/logout', asyncHandler(logout));
authRouter.post('/invite', authMiddleware, adminMiddleware, asyncHandler(createInvite));
authRouter.get('/invite/:token', asyncHandler(verifyInvite));
authRouter.post('/activate', asyncHandler(activateAccount));
authRouter.get('/users', authMiddleware, adminMiddleware, asyncHandler(listUsers));
authRouter.delete('/users/:id', authMiddleware, adminMiddleware, asyncHandler(deleteUser));
authRouter.patch('/users/:id/teacher', authMiddleware, adminMiddleware, asyncHandler(updateUserTeacher));
authRouter.put('/users/:id/auth-roles', authMiddleware, adminMiddleware, asyncHandler(setUserAuthRoles));
