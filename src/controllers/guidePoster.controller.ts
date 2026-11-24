import type { Request, Response } from 'express';
import { AiError } from '../services/ai/types.js';
import { aiImageStatus } from '../services/ai/run.js';
import { acceptPosterDraft, discardPosterDraft, drawPosterDraft, posterImage, PosterProblem } from '../services/guidePoster/index.js';
import { idFromFileName } from '../services/storedImage.service.js';

// How-To Guide → AI poster. Drawing is on request only (Make poster with AI);
// the saved poster is then just shown — see services/guidePoster.

const AI_FAILED = 'AI_FAILED';

async function answer(res: Response, work: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await work() ?? { ok: true });
  } catch (e) {
    if (e instanceof PosterProblem) { res.status(e.status).json({ message: e.message }); return; }
    if (e instanceof AiError) { res.status(422).json({ message: e.message, code: AI_FAILED }); return; }
    throw e;
  }
}

/** Whether "Make poster with AI" can work right now (and why not). */
export async function getPosterAiStatus(_req: Request, res: Response): Promise<void> {
  res.json(await aiImageStatus('guide-poster'));
}

export async function drawPoster(req: Request, res: Response): Promise<void> {
  await answer(res, () => drawPosterDraft(req.params.id, req.user!.id));
}

export async function acceptPoster(req: Request, res: Response): Promise<void> {
  await answer(res, () => acceptPosterDraft(req.params.id));
}

export async function discardPoster(req: Request, res: Response): Promise<void> {
  await answer(res, () => discardPosterDraft(req.params.id));
}

/** The poster (or its draft) picture, for signed-in staff. An id never changes what it shows, so it caches for good. */
export async function getPosterImage(req: Request, res: Response): Promise<void> {
  try {
    const image = await posterImage(req.params.id, idFromFileName(req.params.imageId));
    if (!image) { res.status(404).json({ message: 'Poster not found' }); return; }
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(image.data);
  } catch (e) {
    if (e instanceof PosterProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}
