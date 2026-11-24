import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { and, asc, desc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { purchaseRequests, users } from '../db/schema.js';
import { logPurchase, withHistory } from '../services/purchaseLog.service.js';
import { PURCHASE_RECEIPTS_DIR, discardUploads, toAttachment } from '../services/purchaseReceipts.service.js';
import { parseWeek, weekRange, weekSpend } from '../services/purchaseWeek.service.js';
import { sendPrivateFile } from '../services/privateUploads.service.js';
import { notify, notifyOwner } from '../services/notifications.service.js';
import { itemBoughtMessage, itemRequestedMessage, myRequestMessage } from '../services/notifications.logic.js';
import { PURCHASE_PHOTOS_DIR } from '../services/purchasePhotos.service.js';
import { isAdminRole, resolveGrants } from '../middlewares/auth.middleware.js';

// Purchase requests (Operation → Shopping List). Any staff member asks for
// something to be bought; shopping-list managers (OPERATION_PURCHASE_MANAGE
// view; Admins always) work through it week by week:
//   REQUESTED  — waiting for approval; the requester can still edit or withdraw it
//   APPROVED   — confirmed for buying; locked for the requester; can now be ticked
//   BOUGHT     — optional cost + receipt photo
//   NOT_BUYING — with a reason the requester sees
//   CANCELLED  — withdrawn by the requester before approval (kept, hidden)
// Anything not handled stays on the list, so it carries over week to week.
// Every step is written to PurchaseRequestLog (purchaseLog.service), so
// there's a record of when it was asked for and what happened to it.

const MAX_COST_RM = 100_000;
/** Still on the shopping list — waiting for approval, or approved and waiting to be bought. */
const OPEN_STATUSES = ['REQUESTED', 'APPROVED'] as const;

const createSchema = z.object({
  item: z.string().trim().min(1, 'What needs to be bought?').max(191),
  quantity: z.string().trim().min(1, 'How many?').max(50),
  purpose: z.string().trim().min(1, 'Which class, or what is it for?').max(191),
  note: z.string().trim().max(2000).nullable().optional(),
  link: z.string().trim().max(500).url('Paste the full shop link (starting https://)').nullable().optional().or(z.literal('')),
  // SELF = the requester will buy it (after approval) and ask to be paid back.
  buyer: z.enum(['SUPERVISOR', 'SELF']).default('SUPERVISOR'),
});

const notBuyingSchema = z.object({
  reason: z.string().trim().min(1, 'Say why it isn’t being bought — they’ll see this').max(500),
});

const noteSchema = z.object({ note: z.string().trim().max(500) });

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

/** The signed-in person, as the log records them. */
async function actor(req: Request): Promise<{ authorUserId: string; authorName: string }> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id));
  return { authorUserId: req.user!.id, authorName: u?.name ?? req.user!.email };
}

async function loadOne(id: string) {
  const [row] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id));
  return row ?? null;
}

/** One request with its history — what every change answers with. */
async function respondWith(res: Response, id: string, status = 200): Promise<void> {
  const row = await loadOne(id);
  res.status(status).json(row ? (await withHistory([row]))[0] : null);
}

/** The cost typed in when ticking an item bought: '' / absent = not given; otherwise RM to the sen. */
export function parseCost(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COST_RM) return { ok: false, message: 'Enter the cost in RM, e.g. 12.50' };
  return { ok: true, value: n.toFixed(2) };
}

/** Any signed-in staff member can ask for something to be bought; "Requested by" and the time are the server's. */
export async function createPurchaseRequest(req: Request, res: Response): Promise<void> {
  // Photos (optional) arrive as multipart — purchasePhotosUpload has already saved them; a refused request deletes them.
  const photos = (req.files as Express.Multer.File[] | undefined) ?? [];
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { discardUploads(photos); validationError(res, parsed.error); return; }
  const d = parsed.data;
  const who = await actor(req);
  const now = new Date();
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(purchaseRequests).values({
      photos: photos.length ? photos.map(toAttachment) : null,
      id, item: d.item, quantity: d.quantity, purpose: d.purpose,
      note: d.note || null, link: d.link || null, status: 'REQUESTED', buyer: d.buyer,
      requestedByUserId: who.authorUserId, requestedByName: who.authorName,
      createdAt: now, updatedAt: now,
    });
    await logPurchase(tx, { requestId: id, kind: 'REQUESTED', detail: `${d.item} × ${d.quantity}${d.buyer === 'SELF' ? ' · will buy it themselves' : ''}`, ...who, at: now });
  });
  await notify(itemRequestedMessage({ item: d.item, quantity: d.quantity, requestedByName: who.authorName }), { actorUserId: who.authorUserId });
  await respondWith(res, id, 201);
}

/** The requester's own request, still waiting for approval — or why they can't change it. */
async function ownEditable(req: Request, res: Response) {
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED' || existing.requestedByUserId !== req.user!.id) {
    res.status(404).json({ message: 'Request not found' });
    return null;
  }
  if (existing.status !== 'REQUESTED') {
    res.status(409).json({ message: 'It’s already been approved, so it can’t be changed — ask your supervisor' });
    return null;
  }
  return existing;
}

const FIELD_LABELS: Record<string, string> = { item: 'item', quantity: 'how many', purpose: 'what for', note: 'notes', link: 'shop link', buyer: 'who buys it' };

/** The requester edits their own request — only while it's waiting for approval. */
export async function updatePurchaseRequest(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await ownEditable(req, res);
  if (!existing) return;
  const d = parsed.data;
  const next = { item: d.item, quantity: d.quantity, purpose: d.purpose, note: d.note || null, link: d.link || null, buyer: d.buyer };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(k => next[k] !== existing[k]);
  if (changed.length === 0) { await respondWith(res, existing.id); return; }
  const who = await actor(req);
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({ ...next, updatedAt: now }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'EDITED', detail: `Changed ${changed.map(k => FIELD_LABELS[k]).join(', ')}`, ...who, at: now });
  });
  await respondWith(res, existing.id);
}

/** The requester withdraws their own request before approval. Kept (CANCELLED) for the record, hidden from the lists. */
export async function cancelPurchaseRequest(req: Request, res: Response): Promise<void> {
  const existing = await ownEditable(req, res);
  if (!existing) return;
  const who = await actor(req);
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({ status: 'CANCELLED', updatedAt: now }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'CANCELLED', detail: 'Withdrawn by the requester', ...who, at: now });
  });
  res.status(204).end();
}

/** Confirm one request for buying. From then on it can be ticked, and the requester can't change it. */
export async function approvePurchase(req: Request, res: Response): Promise<void> {
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED') { res.status(404).json({ message: 'Request not found' }); return; }
  if (existing.status !== 'REQUESTED') { res.status(409).json({ message: 'Only a request waiting for approval can be approved' }); return; }
  const who = await actor(req);
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({ status: 'APPROVED', updatedAt: now }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'APPROVED', ...who, at: now });
  });
  await tellRequester(existing, 'APPROVED', who.authorUserId);
  await respondWith(res, existing.id);
}

/** Approve everything waiting — the whole list at once. Answers how many were approved. */
export async function approveAllPurchases(req: Request, res: Response): Promise<void> {
  const who = await actor(req);
  const now = new Date();
  const approved = await db.transaction(async tx => {
    const waiting = await tx.select().from(purchaseRequests)
      .where(eq(purchaseRequests.status, 'REQUESTED')).for('update');
    for (const { id } of waiting) {
      await tx.update(purchaseRequests).set({ status: 'APPROVED', updatedAt: now }).where(eq(purchaseRequests.id, id));
      await logPurchase(tx, { requestId: id, kind: 'APPROVED', detail: 'Approved with the whole list', ...who, at: now });
    }
    return waiting;
  });
  for (const r of approved) await tellRequester(r, 'APPROVED', who.authorUserId);
  res.json({ approved: approved.length });
}

/**
 * The caller's own requests with their history, newest first. The cost is the
 * office's business — except on something they bought themselves, where it's
 * what they're being paid back. Receipt photos stay with the office.
 */
export async function listMyPurchaseRequests(req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.requestedByUserId, req.user!.id), ne(purchaseRequests.status, 'CANCELLED')))
    .orderBy(desc(purchaseRequests.createdAt));
  const withLog = await withHistory(rows.map(({ cost, receipt, ...r }) => ({
    ...r, ...(r.buyer === 'SELF' ? { cost, hasReceipt: !!receipt } : {}),
  })));
  // The history's cost lines would give the price away — leave them out, unless it's their own self-buy.
  res.json(withLog.map(r => (r.buyer === 'SELF' ? r : { ...r, history: r.history.filter(h => h.kind !== 'COST') })));
}

/**
 * The shopping list for a week (?week=YYYY-MM-DD, default this week):
 * everything still to buy (whenever it was asked for — oldest first), what
 * was bought / turned down that week, what the week cost — and, for a past
 * week, what was on its list but NOT bought that week (carried over), so the
 * week keeps a record of it.
 */
export async function getShoppingList(req: Request, res: Response): Promise<void> {
  const weekStart = parseWeek(req.query.week);
  const { from, to } = weekRange(weekStart);
  const inWeek = and(gte(purchaseRequests.handledAt, from), lt(purchaseRequests.handledAt, to));
  const toBuy = await db.select().from(purchaseRequests)
    .where(inArray(purchaseRequests.status, [...OPEN_STATUSES])).orderBy(asc(purchaseRequests.createdAt));
  const bought = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.status, 'BOUGHT'), inWeek)).orderBy(asc(purchaseRequests.handledAt));
  const notBuying = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.status, 'NOT_BUYING'), inWeek)).orderBy(asc(purchaseRequests.handledAt));
  // Asked for by the end of that week, and still open when it ended.
  const carriedOver = await db.select().from(purchaseRequests)
    .where(and(
      lt(purchaseRequests.createdAt, to),
      or(inArray(purchaseRequests.status, [...OPEN_STATUSES]), gte(purchaseRequests.handledAt, to)),
    ))
    .orderBy(asc(purchaseRequests.createdAt));
  res.json({
    weekStart,
    toBuy: await withHistory(toBuy),
    bought: await withHistory(bought),
    notBuying: await withHistory(notBuying),
    carriedOver: await withHistory(carriedOver),
    spend: weekSpend(bought),
  });
}

/**
 * Tick an item bought — or, for one already bought, add / change its cost
 * and receipt photo. Multipart: optional `cost` (RM) and `receipt` file
 * (purchaseReceiptUpload has already saved it). A new receipt replaces the old.
 */
export async function markPurchaseBought(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED') { discardUploads(files); res.status(404).json({ message: 'Request not found' }); return; }
  await applyBought(req, res, existing, files);
}

/**
 * The requester marks their own self-buy as bought (with cost + receipt, to
 * be paid back) — only for a request they said they'd buy themselves, and
 * only once it's approved. Multipart like markPurchaseBought.
 */
export async function markBoughtMyself(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED' || existing.requestedByUserId !== req.user!.id) {
    discardUploads(files); res.status(404).json({ message: 'Request not found' }); return;
  }
  if (existing.buyer !== 'SELF') {
    discardUploads(files); res.status(409).json({ message: 'This one is on the shopping list to be bought for you' }); return;
  }
  await applyBought(req, res, existing, files);
}

type PurchaseRow = typeof purchaseRequests.$inferSelect;

/** Tick bought (first time) and/or set its cost / receipt. Only approved (or already-bought) items. */
async function applyBought(req: Request, res: Response, existing: PurchaseRow, files: Express.Multer.File[]): Promise<void> {
  // Only approved items can be ticked (or, once bought, have their cost / receipt changed).
  if (existing.status !== 'APPROVED' && existing.status !== 'BOUGHT') {
    discardUploads(files);
    res.status(409).json({ message: 'It needs approving first — only approved items can be bought' });
    return;
  }
  const cost = parseCost(req.body?.cost);
  if (cost.ok === false) { discardUploads(files); res.status(400).json({ message: cost.message }); return; }

  const who = await actor(req);
  const now = new Date();
  const firstTick = existing.status !== 'BOUGHT';
  const receipt = files[0] ? toAttachment(files[0]) : undefined;
  const costChanged = cost.value !== undefined && cost.value !== (existing.cost ?? null);
  if (receipt && existing.receipt) discardUploads([{ path: path.join(PURCHASE_RECEIPTS_DIR, existing.receipt.id) }]);

  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({
      status: 'BOUGHT',
      declineReason: null,
      ...(cost.value !== undefined ? { cost: cost.value } : {}),
      ...(receipt ? { receipt } : {}),
      ...(firstTick ? { handledAt: now, handledByName: who.authorName } : {}),
      updatedAt: now,
    }).where(eq(purchaseRequests.id, existing.id));
    if (firstTick) await logPurchase(tx, { requestId: existing.id, kind: 'BOUGHT', ...who, at: now });
    if (costChanged || receipt) {
      const parts = [costChanged ? (cost.value ? `Cost RM ${cost.value}` : 'Cost cleared') : null, receipt ? 'Receipt photo added' : null];
      // 1 ms after the tick, so the history always reads "bought" then "cost" (same-instant rows have no fixed order).
      await logPurchase(tx, { requestId: existing.id, kind: 'COST', detail: parts.filter(Boolean).join(' · '), ...who, at: new Date(now.getTime() + 1) });
    }
  });
  if (firstTick) await tellRequester(existing, 'BOUGHT', who.authorUserId);
  // The first time a cost is entered, Finance records it in operating costs.
  if (cost.value && !existing.cost) {
    await notify(itemBoughtMessage({ item: existing.item, quantity: existing.quantity, cost: cost.value }), { actorUserId: who.authorUserId });
  }
  await respondWith(res, existing.id);
}

/** Turn a request down, with the reason the requester will see. Only from the list (undo a purchase first). */
export async function markPurchaseNotBuying(req: Request, res: Response): Promise<void> {
  const parsed = notBuyingSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED') { res.status(404).json({ message: 'Request not found' }); return; }
  if (existing.status !== 'REQUESTED' && existing.status !== 'APPROVED') { res.status(409).json({ message: 'Put it back on the list first' }); return; }
  const who = await actor(req);
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({
      status: 'NOT_BUYING', declineReason: parsed.data.reason, handledAt: now, handledByName: who.authorName, updatedAt: now,
    }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'NOT_BUYING', detail: parsed.data.reason, ...who, at: now });
  });
  await tellRequester(existing, 'NOT_BUYING', who.authorUserId, parsed.data.reason);
  await respondWith(res, existing.id);
}

/** Tell whoever asked for it what happened to their request (not when they did it themselves). */
async function tellRequester(r: PurchaseRow, outcome: 'APPROVED' | 'BOUGHT' | 'NOT_BUYING', actorUserId: string | null, reason?: string | null): Promise<void> {
  await notifyOwner(teacherId => myRequestMessage({ teacherId, item: r.item, quantity: r.quantity, outcome, reason }),
    { userId: r.requestedByUserId }, { actorUserId });
}

/** One step back, for mistakes — the history keeps both steps. */
const STEP_BACK: Partial<Record<string, { to: 'REQUESTED' | 'APPROVED'; detail: string }>> = {
  BOUGHT: { to: 'APPROVED', detail: 'Unticked — was bought' },        // stays approved, cost / receipt cleared
  NOT_BUYING: { to: 'REQUESTED', detail: 'Was marked not buying' },   // needs approving again
  APPROVED: { to: 'REQUESTED', detail: 'Approval taken back' },
};

/** Undo: bought → approved, not buying → waiting for approval, approved → waiting for approval. */
export async function returnPurchaseToList(req: Request, res: Response): Promise<void> {
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED') { res.status(404).json({ message: 'Request not found' }); return; }
  const step = STEP_BACK[existing.status];
  if (!step) { await respondWith(res, existing.id); return; }
  const who = await actor(req);
  const now = new Date();
  if (existing.receipt) discardUploads([{ path: path.join(PURCHASE_RECEIPTS_DIR, existing.receipt.id) }]);
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({
      status: step.to, cost: null, receipt: null, declineReason: null, handledAt: null, handledByName: null, updatedAt: now,
    }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'BACK_TO_LIST', detail: step.detail, ...who, at: now });
  });
  await respondWith(res, existing.id);
}

/**
 * Add, change or clear (empty) the supervisor's note on an item — any
 * status. The requester sees it next to their request.
 */
export async function setPurchaseNote(req: Request, res: Response): Promise<void> {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await loadOne(req.params.id);
  if (!existing || existing.status === 'CANCELLED') { res.status(404).json({ message: 'Request not found' }); return; }
  const note = parsed.data.note || null;
  if (note === existing.supervisorNote) { await respondWith(res, existing.id); return; }
  const who = await actor(req);
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(purchaseRequests).set({
      supervisorNote: note, supervisorNoteByName: note ? who.authorName : null, updatedAt: now,
    }).where(eq(purchaseRequests.id, existing.id));
    await logPurchase(tx, { requestId: existing.id, kind: 'NOTE', detail: note ?? 'Note removed', ...who, at: now });
  });
  await respondWith(res, existing.id);
}

/** The receipt photo — managers only (route gate). */
export async function getPurchaseReceipt(req: Request, res: Response): Promise<void> {
  const existing = await loadOne(req.params.id);
  if (!existing?.receipt) { res.status(404).json({ message: 'No receipt' }); return; }
  sendPrivateFile(res, PURCHASE_RECEIPTS_DIR, existing.receipt.id, existing.receipt.mime);
}

/** A photo the requester attached — to them, the shopping-list managers and Admins (asked for with or without its extension, see facility attachments). */
export async function getPurchasePhoto(req: Request, res: Response): Promise<void> {
  const existing = await loadOne(req.params.id);
  const wanted = req.params.fileId;
  const file = existing?.photos?.find(p => p.id === wanted || p.id.replace(/\.[a-z0-9]+$/i, '') === wanted);
  if (!existing || !file) { res.status(404).json({ message: 'Photo not found' }); return; }
  const mayView = existing.requestedByUserId === req.user!.id
    || isAdminRole(req.user!.role)
    || (await resolveGrants(req.user!.id)).views.has('OPERATION_PURCHASE_MANAGE');
  if (!mayView) { res.status(403).json({ message: 'Forbidden' }); return; }
  // The id comes from the stored list, never straight from the URL, so it can't point outside the folder.
  sendPrivateFile(res, PURCHASE_PHOTOS_DIR, file.id, file.mime);
}
