import { Request, Response } from 'express';
import { z } from 'zod';
import { markAllRead, markRead, notificationsFor, saveMutedKinds, settingsFor } from '../services/notifications.service.js';
import { NOTIFICATION_KINDS } from '../services/notifications.logic.js';

// The bell in the top bar: the signed-in person's own notifications only.

export async function listMyNotifications(req: Request, res: Response): Promise<void> {
  res.json(await notificationsFor(req.user!.id));
}

export async function readNotification(req: Request, res: Response): Promise<void> {
  if (!(await markRead(req.user!.id, req.params.id))) { res.status(404).json({ message: 'Notification not found' }); return; }
  res.json({ ok: true });
}

/** Settings → Notifications: which events the caller receives, grouped by category. */
export async function getNotificationSettings(req: Request, res: Response): Promise<void> {
  res.json({ events: await settingsFor(req.user!.id, req.user!.role) });
}

const settingsSchema = z.object({
  /** The events to switch OFF — everything else stays on. */
  muted: z.array(z.string()).max(NOTIFICATION_KINDS.length),
});

export async function saveNotificationSettings(req: Request, res: Response): Promise<void> {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Validation error', errors: parsed.error.errors }); return; }
  // Only events your roles give you can be switched off (anything else isn't yours to change).
  const mine = new Set((await settingsFor(req.user!.id, req.user!.role)).map(e => e.kind));
  const notMine = parsed.data.muted.filter(k => !mine.has(k as never));
  if (notMine.length) { res.status(400).json({ message: `You don’t receive these notifications: ${notMine.join(', ')}` }); return; }
  await saveMutedKinds(req.user!.id, parsed.data.muted);
  res.json({ events: await settingsFor(req.user!.id, req.user!.role) });
}

export async function readAllNotifications(req: Request, res: Response): Promise<void> {
  await markAllRead(req.user!.id);
  res.json({ ok: true });
}
