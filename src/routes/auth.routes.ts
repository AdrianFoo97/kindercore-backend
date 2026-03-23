import { Router } from 'express';
import { login, createInvite, verifyInvite, activateAccount, listUsers, deleteUser } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(login));
authRouter.post('/invite', authMiddleware, asyncHandler(createInvite));
authRouter.get('/invite/:token', asyncHandler(verifyInvite));
authRouter.post('/activate', asyncHandler(activateAccount));
authRouter.get('/users', authMiddleware, asyncHandler(listUsers));
authRouter.delete('/users/:id', authMiddleware, asyncHandler(deleteUser));
