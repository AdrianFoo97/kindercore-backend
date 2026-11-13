import { Router } from 'express';
import {
  approveAllPurchases, approvePurchase, cancelPurchaseRequest, createPurchaseRequest, getPurchaseReceipt, getShoppingList,
  listMyPurchaseRequests, markBoughtMyself, markPurchaseBought, markPurchaseNotBuying, returnPurchaseToList, setPurchaseNote, updatePurchaseRequest,
} from '../controllers/purchase-requests.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { purchaseReceiptUpload } from '../services/purchaseReceipts.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const purchaseRequestsRouter = Router();

// Two levels:
//  - any staff member asks for something to be bought, sees their own
//    requests, and can edit / withdraw their own until it's approved
//    (ownership + status checked in the handler);
//  - shopping-list managers (OPERATION_PURCHASE_MANAGE view, granted per role
//    in Admin → Views; Admins always) approve the list and tick items off.
purchaseRequestsRouter.post('/purchase-requests', authMiddleware, asyncHandler(createPurchaseRequest));
purchaseRequestsRouter.get('/purchase-requests/mine', authMiddleware, asyncHandler(listMyPurchaseRequests));
purchaseRequestsRouter.patch('/purchase-requests/:id', authMiddleware, asyncHandler(updatePurchaseRequest));
purchaseRequestsRouter.delete('/purchase-requests/:id', authMiddleware, asyncHandler(cancelPurchaseRequest));
purchaseRequestsRouter.post('/purchase-requests/:id/bought-myself', authMiddleware, purchaseReceiptUpload, asyncHandler(markBoughtMyself));
purchaseRequestsRouter.get('/purchase-requests/shopping-list', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(getShoppingList));
purchaseRequestsRouter.post('/purchase-requests/approve-all', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(approveAllPurchases));
purchaseRequestsRouter.post('/purchase-requests/:id/approve', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(approvePurchase));
purchaseRequestsRouter.post('/purchase-requests/:id/bought', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), purchaseReceiptUpload, asyncHandler(markPurchaseBought));
purchaseRequestsRouter.post('/purchase-requests/:id/not-buying', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(markPurchaseNotBuying));
purchaseRequestsRouter.post('/purchase-requests/:id/back-to-list', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(returnPurchaseToList));
purchaseRequestsRouter.put('/purchase-requests/:id/note', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(setPurchaseNote));
purchaseRequestsRouter.get('/purchase-requests/:id/receipt', authMiddleware, requireView('OPERATION_PURCHASE_MANAGE'), asyncHandler(getPurchaseReceipt));
