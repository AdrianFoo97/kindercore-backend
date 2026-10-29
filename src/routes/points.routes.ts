import { Router } from 'express';
import {
  listRules, createRule, updateRule, deleteRule,
  listRewards, createReward, updateReward, deleteReward,
  getTeacherPoints, listTransactions, grantPoints, markPointsSeen,
  updateTransaction, deleteTransaction,
  listRedemptions, listAllRedemptions, getRedemption, redeemReward, updateRedemption,
  setGoal, clearGoal,
  getStandings,
} from '../controllers/points.controller.js';
import { authMiddleware, requireModule, selfOrModule, adminMiddleware } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const pointsRouter = Router();

// Admin global catalog / rules
pointsRouter.get('/points/rules', authMiddleware, asyncHandler(listRules));
pointsRouter.post('/points/rules', authMiddleware, adminMiddleware, asyncHandler(createRule));
pointsRouter.patch('/points/rules/:id', authMiddleware, adminMiddleware, asyncHandler(updateRule));
pointsRouter.delete('/points/rules/:id', authMiddleware, adminMiddleware, asyncHandler(deleteRule));

pointsRouter.get('/points/rewards', authMiddleware, asyncHandler(listRewards));
pointsRouter.post('/points/rewards', authMiddleware, adminMiddleware, asyncHandler(createReward));
pointsRouter.patch('/points/rewards/:id', authMiddleware, adminMiddleware, asyncHandler(updateReward));
pointsRouter.delete('/points/rewards/:id', authMiddleware, adminMiddleware, asyncHandler(deleteReward));

// Teacher-scoped points
pointsRouter.get('/teachers/:teacherId/points', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getTeacherPoints));
pointsRouter.get('/teachers/:teacherId/points/standings', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(getStandings));
pointsRouter.get('/teachers/:teacherId/points/transactions', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(listTransactions));
pointsRouter.post('/teachers/:teacherId/points/grant', authMiddleware, requireModule(MODULES.HR), asyncHandler(grantPoints));
// Acknowledge the new-grants banner on the teacher's Rewards hub.
pointsRouter.post('/teachers/:teacherId/points/seen', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(markPointsSeen));
// Edit / delete a manual grant. Redemption-linked rows are rejected
// (they mirror the redemption record).
pointsRouter.patch('/transactions/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(updateTransaction));
pointsRouter.delete('/transactions/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(deleteTransaction));
pointsRouter.put('/teachers/:teacherId/points/goal', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(setGoal));
pointsRouter.delete('/teachers/:teacherId/points/goal', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(clearGoal));

// Teacher-scoped rewards / redemptions
pointsRouter.get('/teachers/:teacherId/rewards', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(listRedemptions));
pointsRouter.post('/teachers/:teacherId/rewards/redeem', authMiddleware, selfOrModule(MODULES.HR), asyncHandler(redeemReward));
// Admin fulfilment workbench — all redemptions across teachers.
pointsRouter.get('/redemptions', authMiddleware, requireModule(MODULES.HR), asyncHandler(listAllRedemptions));
pointsRouter.get('/redemptions/:id', authMiddleware, asyncHandler(getRedemption));
pointsRouter.patch('/redemptions/:id', authMiddleware, requireModule(MODULES.HR), asyncHandler(updateRedemption));
