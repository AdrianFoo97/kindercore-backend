import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { sopFavorites, sopTemplates } from '../../db/schema.js';
import { addFavorite, listMyFavorites, removeFavorite } from '../../controllers/sop-favorites.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Guides → favourites: each person stars the guides they use; the Guides
// page opens on them. Real handlers, real (test) DB.

const NOW = new Date('2026-01-01T00:00:00Z');
const TINA = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: null };
const OMAR = { id: 'u-omar', email: 'omar@kindertech.test', role: 'USER', teacherId: null };

beforeEach(async () => {
  await resetTables(sopFavorites, sopTemplates);
  await db.insert(sopTemplates).values([
    { id: 'g-drop', title: 'Morning drop-off', createdAt: NOW, updatedAt: NOW },
    { id: 'g-nap', title: 'Nap time', createdAt: NOW, updatedAt: NOW },
    { id: 'g-old', title: 'Retired guide', createdAt: NOW, updatedAt: NOW, deletedAt: NOW },
  ]);
});
afterAll(async () => {
  await pool.end();
});

const call = async (fn: typeof addFavorite, user: typeof TINA, sopTemplateId?: string) => {
  const r = res();
  await fn(reqWith({ user, params: sopTemplateId ? { sopTemplateId } : {} }), r);
  return r;
};

describe('Operation — favourite guides', () => {
  it('stars and unstars a guide, and starring twice keeps one', async () => {
    await call(addFavorite, TINA, 'g-drop');
    await call(addFavorite, TINA, 'g-drop');
    await call(addFavorite, TINA, 'g-nap');
    expect((await call(listMyFavorites, TINA)).body.sort()).toEqual(['g-drop', 'g-nap']);
    await call(removeFavorite, TINA, 'g-nap');
    expect((await call(listMyFavorites, TINA)).body).toEqual(['g-drop']);
  });

  it('keeps each person\'s favourites to themselves', async () => {
    await call(addFavorite, TINA, 'g-drop');
    expect((await call(listMyFavorites, OMAR)).body).toEqual([]);
    await call(removeFavorite, OMAR, 'g-drop'); // can't remove someone else's
    expect((await call(listMyFavorites, TINA)).body).toEqual(['g-drop']);
  });

  it('cannot star a guide that does not exist or was deleted', async () => {
    expect((await call(addFavorite, TINA, 'g-old')).statusCode).toBe(404);
    expect((await call(addFavorite, TINA, 'nope')).statusCode).toBe(404);
    expect((await call(listMyFavorites, TINA)).body).toEqual([]);
  });
});
