import type { Request, Response } from 'express';
import { z } from 'zod';
import { MAX_MESSAGE_LENGTH, MAX_REQUEST_LENGTH, RewriteError, rewriteMessage } from '../services/messageRewrite/index.js';

// Settings → Message templates → Rewrite with AI. Returns a suggestion only — saves nothing.

const bodySchema = z.object({
  text: z.string().trim().min(1, 'Write the message first.').max(MAX_MESSAGE_LENGTH, 'That message is too long to rewrite.'),
  request: z.string().trim().min(1, 'Say how it should change.').max(MAX_REQUEST_LENGTH, 'Keep the request short.'),
});

export async function rewriteMessageHandler(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Validation error' }); return; }
  try {
    res.json({ text: await rewriteMessage(parsed.data.text, parsed.data.request, req.user!.id) });
  } catch (e) {
    if (e instanceof RewriteError) { res.status(422).json({ message: e.message }); return; }
    throw e;
  }
}
