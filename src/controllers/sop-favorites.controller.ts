import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sopFavorites, sopTemplates } from '../db/schema.js';

// A person's favourite How-To Guides. Each person only ever sees and
// changes their own — the user comes from the session, never the request.

/** The ids of the guides I've starred. */
export async function listMyFavorites(req: Request, res: Response): Promise<void> {
  const rows = await db.select({ sopTemplateId: sopFavorites.sopTemplateId })
    .from(sopFavorites).where(eq(sopFavorites.userId, req.user!.id));
  res.json(rows.map(r => r.sopTemplateId));
}

/** Star a guide (doing it twice is fine). */
export async function addFavorite(req: Request, res: Response): Promise<void> {
  const { sopTemplateId } = req.params;
  const [guide] = await db.select({ id: sopTemplates.id }).from(sopTemplates)
    .where(and(eq(sopTemplates.id, sopTemplateId), isNull(sopTemplates.deletedAt)));
  if (!guide) { res.status(404).json({ message: 'How-To Guide not found' }); return; }
  const userId = req.user!.id;
  const [existing] = await db.select({ id: sopFavorites.id }).from(sopFavorites)
    .where(and(eq(sopFavorites.userId, userId), eq(sopFavorites.sopTemplateId, sopTemplateId)));
  if (!existing) {
    await db.insert(sopFavorites).values({ id: randomUUID(), userId, sopTemplateId, createdAt: new Date() });
  }
  res.json({ sopTemplateId, favorite: true });
}

/** Unstar a guide. */
export async function removeFavorite(req: Request, res: Response): Promise<void> {
  const { sopTemplateId } = req.params;
  await db.delete(sopFavorites)
    .where(and(eq(sopFavorites.userId, req.user!.id), eq(sopFavorites.sopTemplateId, sopTemplateId)));
  res.json({ sopTemplateId, favorite: false });
}
