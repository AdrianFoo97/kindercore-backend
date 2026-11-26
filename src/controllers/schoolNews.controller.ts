import type { Request, Response } from 'express';
import { hideNews, recentNews } from '../services/schoolNews.service.js';

// School news on Home — everyone reads it; Students staff can hide a post.

export async function getSchoolNews(_req: Request, res: Response): Promise<void> {
  res.json(await recentNews());
}

export async function postHideSchoolNews(req: Request, res: Response): Promise<void> {
  if (!(await hideNews(req.params.id, req.user!))) { res.status(404).json({ message: 'That news isn’t there any more.' }); return; }
  res.json({ ok: true });
}
