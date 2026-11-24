import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sopSteps, sopTemplates, storedImages } from '../../db/schema.js';
import { runAiImage } from '../ai/run.js';
import { findImage, saveImage } from '../storedImage.service.js';
import { posterProblem, posterPrompt } from './prompt.js';

// How-To Guide → AI poster. Drawn ONCE on request and saved; opening the
// poster afterwards just shows the saved picture (no AI request). A new
// drawing first waits as a draft — the person checks every word, then uses
// it (it replaces the poster) or discards it. A guide holds at most two
// pictures: its poster and one draft.

export const GUIDE_POSTER_KIND = 'guide-poster';

/** Something the person can fix — the message is safe to show. */
export class PosterProblem extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function loadGuide(templateId: string) {
  const [guide] = await db.select().from(sopTemplates).where(and(eq(sopTemplates.id, templateId), isNull(sopTemplates.deletedAt)));
  if (!guide) throw new PosterProblem('Guide not found', 404);
  return guide;
}

const dropImage = (id: string | null) => (id ? db.delete(storedImages).where(and(eq(storedImages.id, id), eq(storedImages.kind, GUIDE_POSTER_KIND))) : null);

/** Draw a new poster with AI and keep it as the guide's draft (replacing any earlier draft). */
export async function drawPosterDraft(templateId: string, userId: string): Promise<{ draftImageId: string; provider: string; model: string }> {
  const guide = await loadGuide(templateId);
  const steps = await db.select({ section: sopSteps.section, title: sopSteps.title }).from(sopSteps)
    .where(and(eq(sopSteps.sopTemplateId, templateId), isNull(sopSteps.deletedAt))).orderBy(asc(sopSteps.displayOrder));
  const problem = posterProblem(steps);
  if (problem) throw new PosterProblem(problem, 400);

  const image = await runAiImage('guide-poster', { prompt: posterPrompt(guide, steps), orientation: 'portrait' }, { userId });
  const draftImageId = await saveImage(GUIDE_POSTER_KIND, image.mimeType, image.data);
  await db.update(sopTemplates).set({ posterDraftImageId: draftImageId }).where(eq(sopTemplates.id, templateId));
  await dropImage(guide.posterDraftImageId);
  return { draftImageId, provider: image.provider, model: image.model };
}

/** Use the checked draft as the guide's poster (the old poster is removed). */
export async function acceptPosterDraft(templateId: string): Promise<void> {
  const guide = await loadGuide(templateId);
  if (!guide.posterDraftImageId) throw new PosterProblem('There’s no new poster waiting — make one first.', 409);
  await db.update(sopTemplates).set({
    posterImageId: guide.posterDraftImageId, posterVersion: guide.currentVersion, posterMadeAt: new Date(), posterDraftImageId: null,
  }).where(eq(sopTemplates.id, templateId));
  await dropImage(guide.posterImageId);
}

/** Throw the draft away; the current poster (if any) stays. */
export async function discardPosterDraft(templateId: string): Promise<void> {
  const guide = await loadGuide(templateId);
  if (!guide.posterDraftImageId) return;
  await db.update(sopTemplates).set({ posterDraftImageId: null }).where(eq(sopTemplates.id, templateId));
  await dropImage(guide.posterDraftImageId);
}

/** The guide's poster or its draft — only those two pictures, never another guide's or another kind. */
export async function posterImage(templateId: string, imageId: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const guide = await loadGuide(templateId);
  if (imageId !== guide.posterImageId && imageId !== guide.posterDraftImageId) return null;
  return findImage(GUIDE_POSTER_KIND, imageId);
}
