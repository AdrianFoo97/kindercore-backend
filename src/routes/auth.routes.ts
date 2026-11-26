import { Router } from 'express';
import { login, logout, createInvite, verifyInvite, activateAccount, listUsers, deleteUser, updateUserTeacher, setUserAuthRoles } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { deleteMyPhoto, getMyPhoto, putMyDisplayName, putMyPhoto } from '../controllers/profilePhoto.controller.js';
import { profilePhotoUpload } from '../services/profilePhoto.service.js';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(login));
authRouter.post('/logout', asyncHandler(logout));
// My Profile → your own photo (never anyone else's — no user id in the address).
authRouter.get('/me/photo', authMiddleware, asyncHandler(getMyPhoto));
authRouter.put('/me/photo', authMiddleware, profilePhotoUpload, asyncHandler(putMyPhoto));
authRouter.delete('/me/photo', authMiddleware, asyncHandler(deleteMyPhoto));
// My Profile → the name the app shows you by (your own only).
authRouter.put('/me/display-name', authMiddleware, asyncHandler(putMyDisplayName));
authRouter.post('/invite', authMiddleware, adminMiddleware, asyncHandler(createInvite));
authRouter.get('/invite/:token', asyncHandler(verifyInvite));
authRouter.post('/activate', asyncHandler(activateAccount));
authRouter.get('/users', authMiddleware, adminMiddleware, asyncHandler(listUsers));
authRouter.delete('/users/:id', authMiddleware, adminMiddleware, asyncHandler(deleteUser));
authRouter.patch('/users/:id/teacher', authMiddleware, adminMiddleware, asyncHandler(updateUserTeacher));
authRouter.put('/users/:id/auth-roles', authMiddleware, adminMiddleware, asyncHandler(setUserAuthRoles));
