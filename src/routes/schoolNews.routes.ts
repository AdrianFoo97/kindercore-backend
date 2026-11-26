import { Router } from 'express';
import { getSchoolNews, postHideSchoolNews } from '../controllers/schoolNews.controller.js';
import { authMiddleware, requireModule } from '../middlewares/auth.middleware.js';
import { MODULES } from '../constants/authModules.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const schoolNewsRouter = Router();

// Everyone signed in reads the news on Home (class + start date only — see
// securityPolicy). Hiding a post is for whoever runs enrolment (the Students module).
schoolNewsRouter.get('/school-news', authMiddleware, asyncHandler(getSchoolNews));
schoolNewsRouter.post('/school-news/:id/hide', authMiddleware, requireModule(MODULES.STUDENTS), asyncHandler(postHideSchoolNews));
