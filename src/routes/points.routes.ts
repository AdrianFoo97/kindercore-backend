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
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { selfOrTeam, teamMember, wholeSchoolHr } from '../middlewares/teamAccess.middleware.js';

export const pointsRouter = Router();

// Admin global catalog / rules
pointsRouter.get('/points/rules', authMiddleware, asyncHandler(listRules));
pointsRouter.post('/points/rules', authMiddleware, wholeSchoolHr(), asyncHandler(createRule));
pointsRouter.patch('/points/rules/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateRule));
pointsRouter.delete('/points/rules/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteRule));

pointsRouter.get('/points/rewards', authMiddleware, asyncHandler(listRewards));
pointsRouter.post('/points/rewards', authMiddleware, wholeSchoolHr(), asyncHandler(createReward));
pointsRouter.patch('/points/rewards/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateReward));
pointsRouter.delete('/points/rewards/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteReward));

// Teacher-scoped points
pointsRouter.get('/teachers/:teacherId/points', authMiddleware, selfOrTeam(), asyncHandler(getTeacherPoints));
pointsRouter.get('/teachers/:teacherId/points/standings', authMiddleware, selfOrTeam(), asyncHandler(getStandings));
pointsRouter.get('/teachers/:teacherId/points/transactions', authMiddleware, selfOrTeam(), asyncHandler(listTransactions));
pointsRouter.post('/teachers/:teacherId/points/grant', authMiddleware, teamMember(), asyncHandler(grantPoints));
// Acknowledge the new-grants banner on the teacher's Rewards hub.
pointsRouter.post('/teachers/:teacherId/points/seen', authMiddleware, selfOrTeam(), asyncHandler(markPointsSeen));
// Edit / delete a manual grant. Redemption-linked rows are rejected
// (they mirror the redemption record).
pointsRouter.patch('/transactions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateTransaction));
pointsRouter.delete('/transactions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(deleteTransaction));
pointsRouter.put('/teachers/:teacherId/points/goal', authMiddleware, selfOrTeam(), asyncHandler(setGoal));
pointsRouter.delete('/teachers/:teacherId/points/goal', authMiddleware, selfOrTeam(), asyncHandler(clearGoal));

// Teacher-scoped rewards / redemptions
pointsRouter.get('/teachers/:teacherId/rewards', authMiddleware, selfOrTeam(), asyncHandler(listRedemptions));
pointsRouter.post('/teachers/:teacherId/rewards/redeem', authMiddleware, selfOrTeam(), asyncHandler(redeemReward));
// Admin fulfilment workbench — all redemptions across teachers.
pointsRouter.get('/redemptions', authMiddleware, wholeSchoolHr(), asyncHandler(listAllRedemptions));
pointsRouter.get('/redemptions/:id', authMiddleware, asyncHandler(getRedemption));
pointsRouter.patch('/redemptions/:id', authMiddleware, wholeSchoolHr(), asyncHandler(updateRedemption));
