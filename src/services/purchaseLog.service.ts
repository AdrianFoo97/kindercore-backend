import { randomUUID } from 'crypto';
import { asc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { purchaseRequestLogs } from '../db/schema.js';

// The add-only history of each purchase request: who did what, when. Written
// in the same transaction as the change it records; never edited or deleted.

export type PurchaseLogKind = typeof purchaseRequestLogs.$inferSelect['kind'];
type LogRow = typeof purchaseRequestLogs.$inferSelect;
export type PurchaseLogEntry = Omit<LogRow, 'purchaseRequestId'>;

type Exec = Pick<typeof db, 'insert'>;

export async function logPurchase(
  exec: Exec,
  e: { requestId: string; kind: PurchaseLogKind; detail?: string | null; authorUserId: string; authorName: string; at: Date },
): Promise<void> {
  await exec.insert(purchaseRequestLogs).values({
    id: randomUUID(), purchaseRequestId: e.requestId, kind: e.kind, detail: e.detail ?? null,
    authorUserId: e.authorUserId, authorName: e.authorName, createdAt: e.at,
  });
}

/** Each request with its history, oldest entry first. */
export async function withHistory<T extends { id: string }>(rows: T[]): Promise<(T & { history: PurchaseLogEntry[] })[]> {
  if (rows.length === 0) return [];
  const logs = await db.select().from(purchaseRequestLogs)
    .where(inArray(purchaseRequestLogs.purchaseRequestId, rows.map(r => r.id)))
    .orderBy(asc(purchaseRequestLogs.createdAt));
  return rows.map(r => ({
    ...r,
    history: logs.filter(l => l.purchaseRequestId === r.id).map(({ purchaseRequestId: _, ...l }) => l),
  }));
}
