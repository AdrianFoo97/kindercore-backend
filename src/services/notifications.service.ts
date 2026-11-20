import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notificationMutes, notifications, users } from '../db/schema.js';
import {
  NOTIFICATION_EVENTS, NOTIFICATION_KINDS, NOTIFICATION_LIST_LIMIT, NOTIFICATION_RETENTION_DAYS, type NotificationMessage,
  mayReceive, notificationSettings,
} from './notifications.logic.js';
import { rolesHeldBy } from './accessRoles.service.js';

const isAdmin = (role: string) => role === 'ADMIN' || role === 'SUPERADMIN';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tell everyone who can act on an event: anyone whose roles open the page it
 * links to (admins always), minus people who switched it off and the person
 * who did it. Each gets their own copy, so read / unread is per person.
 * Never throws — a notification must not stop what it's about.
 */
export async function notify(message: NotificationMessage, opts: { actorUserId?: string | null } = {}): Promise<void> {
  try {
    const event = NOTIFICATION_EVENTS.find(e => e.kind === message.kind);
    if (!event || event.audience.targeted) return; // targeted events go through notifyPeople
    const people = await db.select({ id: users.id, role: users.role, teacherId: users.teacherId }).from(users).where(eq(users.activated, true));
    const muted = new Set((await db.select({ userId: notificationMutes.userId }).from(notificationMutes)
      .where(eq(notificationMutes.kind, message.kind))).map(m => m.userId));
    const recipients: string[] = [];
    for (const p of people) {
      if (p.id === opts.actorUserId || muted.has(p.id)) continue;
      if (await may(message, p)) recipients.push(p.id);
    }
    if (!recipients.length) return;
    const now = new Date();
    await db.insert(notifications).values(recipients.map(userId => ({
      id: randomUUID(), userId, kind: message.kind, title: message.title, body: message.body, link: message.link, createdAt: now,
    })));
  } catch (e) {
    console.warn(`[notifications] Couldn't send ${message.kind}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Tell specific people (an event that names its recipients, e.g. the people who
 * can sign off one appraisal) — minus anyone whose roles don't give this event,
 * anyone who switched it off and whoever did it.
 */
export async function notifyPeople(message: NotificationMessage, userIds: string[], opts: { actorUserId?: string | null } = {}): Promise<void> {
  try {
    const muted = new Set((await db.select({ userId: notificationMutes.userId }).from(notificationMutes)
      .where(eq(notificationMutes.kind, message.kind))).map(m => m.userId));
    const named = [...new Set(userIds)].filter(id => id !== opts.actorUserId && !muted.has(id));
    if (!named.length) return;
    const people = await db.select({ id: users.id, role: users.role, teacherId: users.teacherId }).from(users)
      .where(and(inArray(users.id, named), eq(users.activated, true)));
    const recipients: string[] = [];
    for (const p of people) {
      if (await may(message, p)) recipients.push(p.id);
    }
    if (!recipients.length) return;
    const now = new Date();
    await db.insert(notifications).values(recipients.map(userId => ({
      id: randomUUID(), userId, kind: message.kind, title: message.title, body: message.body, link: message.link, createdAt: now,
    })));
  } catch (e) {
    console.warn(`[notifications] Couldn't send ${message.kind}:`, e instanceof Error ? e.message : e);
  }
}

/** Whether this person's roles (or staff record, for personal events) give them this message. */
async function may(message: NotificationMessage, p: { id: string; role: string; teacherId: string | null }): Promise<boolean> {
  const admin = isAdmin(p.role);
  return mayReceive(message.kind, admin ? [] : await rolesHeldBy(p.id), admin, !!p.teacherId);
}

/**
 * Tell the person something is about — the account behind a staff record
 * (`teacherId`) or a given account (`userId`, e.g. whoever made a request).
 * Only staff accounts: the message links into their own staff pages, so it's
 * built from their staff record id. Never throws.
 */
export async function notifyOwner(
  build: (teacherId: string) => NotificationMessage,
  owner: { userId: string } | { teacherId: string },
  opts: { actorUserId?: string | null } = {},
): Promise<void> {
  try {
    const where = 'userId' in owner ? eq(users.id, owner.userId) : eq(users.teacherId, owner.teacherId);
    const people = await db.select({ id: users.id, teacherId: users.teacherId }).from(users).where(where);
    for (const p of people) {
      if (p.teacherId) await notifyPeople(build(p.teacherId), [p.id], opts);
    }
  } catch (e) {
    console.warn('[notifications] Personal notice skipped:', e instanceof Error ? e.message : e);
  }
}

/** Someone's latest notifications and how many they haven't read. */
export async function notificationsFor(userId: string) {
  const [items, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt)).limit(NOTIFICATION_LIST_LIMIT),
    db.select({ unread: sql<number>`COUNT(*)` }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread: Number(unread) };
}

/** Marks one of the caller's own notifications read. False if it isn't theirs / doesn't exist. */
export async function markRead(userId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  if (!row) return false;
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
  return true;
}

export async function markAllRead(userId: string): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** The events someone may receive (from their roles), with their on / off choice. */
export async function settingsFor(userId: string, role: string) {
  const rows = await db.select({ kind: notificationMutes.kind }).from(notificationMutes).where(eq(notificationMutes.userId, userId));
  const [me] = await db.select({ teacherId: users.teacherId }).from(users).where(eq(users.id, userId));
  return notificationSettings(await rolesHeldBy(userId), isAdmin(role), rows.map(r => r.kind), !!me?.teacherId);
}

/** Saves which events someone has switched off (full replace). Unknown events are refused by the caller. */
export async function saveMutedKinds(userId: string, muted: string[]): Promise<void> {
  const kinds = [...new Set(muted)].filter(k => NOTIFICATION_KINDS.includes(k as never));
  const now = new Date();
  await db.transaction(async tx => {
    await tx.delete(notificationMutes).where(eq(notificationMutes.userId, userId));
    for (const kind of kinds) await tx.insert(notificationMutes).values({ id: randomUUID(), userId, kind, createdAt: now });
  });
}

/** Clears notifications older than the retention window (run at startup). */
export async function purgeOldNotifications(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const [result] = await db.delete(notifications).where(lt(notifications.createdAt, cutoff)) as unknown as [{ affectedRows?: number }];
  return result?.affectedRows ?? 0;
}
