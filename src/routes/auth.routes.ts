import { Router } from 'express';
import { login, createInvite, verifyInvite, activateAccount, listUsers, deleteUser, updateUserTeacher, updateUserAuthRole } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(login));
authRouter.post('/invite', authMiddleware, adminMiddleware, asyncHandler(createInvite));
authRouter.get('/invite/:token', asyncHandler(verifyInvite));
authRouter.post('/activate', asyncHandler(activateAccount));
authRouter.get('/users', authMiddleware, adminMiddleware, asyncHandler(listUsers));
authRouter.delete('/users/:id', authMiddleware, adminMiddleware, asyncHandler(deleteUser));
authRouter.patch('/users/:id/teacher', authMiddleware, adminMiddleware, asyncHandler(updateUserTeacher));
authRouter.patch('/users/:id/auth-role', authMiddleware, adminMiddleware, asyncHandler(updateUserAuthRole));
