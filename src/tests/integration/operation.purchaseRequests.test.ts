import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { purchaseRequestLogs, purchaseRequests, users } from '../../db/schema.js';
import {
  approveAllPurchases, approvePurchase, cancelPurchaseRequest, createPurchaseRequest, getShoppingList, updatePurchaseRequest, listMyPurchaseRequests, markBoughtMyself, markPurchaseBought, markPurchaseNotBuying, returnPurchaseToList, setPurchaseNote,
} from '../../controllers/purchase-requests.controller.js';
import { PURCHASE_RECEIPTS_DIR } from '../../services/purchaseReceipts.service.js';
import { weekStartOf } from '../../services/purchaseWeek.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Purchase requests (Operation → Shopping List): staff ask for things to be
// bought; the supervisor works through the weekly list. Real handlers, test DB.

const TEACHER = { id: 'user-teacher', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-1' };
const OTHER = { id: 'user-other', email: 'omar@kindertech.test', role: 'USER', teacherId: 't-2' };
const SUPERVISOR = { id: 'user-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const written: string[] = [];

beforeEach(async () => {
  await resetTables(purchaseRequestLogs, purchaseRequests, users);
  await db.insert(users).values([
    await activeUser({ id: TEACHER.id, email: TEACHER.email, name: 'Tina Teacher', role: 'USER' }),
    await activeUser({ id: OTHER.id, email: OTHER.email, name: 'Omar Other', role: 'USER' }),
    await activeUser({ id: SUPERVISOR.id, email: SUPERVISOR.email, name: 'Ada Admin' }),
  ]);
});
afterAll(async () => {
  for (const f of written) fs.rmSync(f, { force: true });
  await pool.end();
});

const valid = () => ({ item: 'Glue sticks', quantity: '2 boxes', purpose: 'Sunflower class' });

const ask = async (body: object, user = TEACHER) => {
  const r = res();
  await createPurchaseRequest(reqWith({ body, user }), r);
  return r;
};
const call = async (fn: typeof markPurchaseBought, id: string, body: object = {}, files: Express.Multer.File[] = []) => {
  const r = res();
  const rq = reqWith({ body, params: { id }, user: SUPERVISOR });
  (rq as any).files = files;
  await fn(rq, r);
  return r;
};
/** Approve (as the supervisor), then tick bought — buying needs approval first. */
const buy = async (id: string, body: object = {}, files: Express.Multer.File[] = []) => {
  await call(approvePurchase, id);
  return call(markPurchaseBought, id, body, files);
};
const list = async (week?: string) => {
  const r = res();
  const rq = reqWith({ user: SUPERVISOR });
  (rq as any).query = week ? { week } : {};
  await getShoppingList(rq, r);
  return r.body;
};
function receiptFile() {
  const filename = `${randomUUID()}.jpg`;
  const p = path.join(PURCHASE_RECEIPTS_DIR, filename);
  fs.writeFileSync(p, 'receipt');
  written.push(p);
  return { filename, path: p, originalname: 'receipt.jpg', mimetype: 'image/jpeg', size: 1024 } as Express.Multer.File;
}

describe('Operation — purchase requests and the shopping list', () => {
  it('files a request on the list, asked for by whoever is signed in', async () => {
    const r = await ask({ ...valid(), note: 'The thick ones', link: 'https://shop.example/glue' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ item: 'Glue sticks', quantity: '2 boxes', status: 'REQUESTED', requestedByName: 'Tina Teacher', link: 'https://shop.example/glue' });
  });

  it('needs what, how many and what for — and a real link if one is given', async () => {
    expect((await ask({ ...valid(), item: ' ' })).statusCode).toBe(400);
    expect((await ask({ ...valid(), quantity: '' })).statusCode).toBe(400);
    expect((await ask({ ...valid(), purpose: '' })).statusCode).toBe(400);
    expect((await ask({ ...valid(), link: 'not a link' })).statusCode).toBe(400);
    expect(await db.select().from(purchaseRequests)).toHaveLength(0);
  });

  it('shows each person only their own requests, without the cost or receipt', async () => {
    const { id } = (await ask(valid())).body;
    await ask({ ...valid(), item: 'Tissue' }, OTHER);
    await buy(id, { cost: '9.90' });
    const r = res();
    await listMyPurchaseRequests(reqWith({ user: TEACHER }), r);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ status: 'BOUGHT' });
    expect(r.body[0]).not.toHaveProperty('cost');
    expect(r.body[0]).not.toHaveProperty('receipt');
  });

  it('keeps unbought items on the list from week to week, oldest first', async () => {
    const old = (await ask({ ...valid(), item: 'Crayons' })).body.id;
    await db.update(purchaseRequests).set({ createdAt: new Date(Date.now() - 14 * DAY_MS) }).where(eq(purchaseRequests.id, old));
    await ask(valid());
    const body = await list();
    expect(body.toBuy.map((i: { item: string }) => i.item)).toEqual(['Crayons', 'Glue sticks']);
  });

  it('ticks an item bought with its cost and receipt, and adds up the week', async () => {
    const a = (await ask(valid())).body.id;
    const b = (await ask({ ...valid(), item: 'Tissue' })).body.id;
    const bought = await buy(a, { cost: '12.50' }, [receiptFile()]);
    expect(bought.body).toMatchObject({ status: 'BOUGHT', cost: '12.50', handledByName: 'Ada Admin' });
    expect(bought.body.receipt).toMatchObject({ kind: 'image', name: 'receipt.jpg' });
    await buy(b); // no cost yet
    const body = await list();
    expect(body.toBuy).toHaveLength(0);
    expect(body.bought).toHaveLength(2);
    expect(body.spend).toEqual({ total: 12.5, uncosted: 1 });
  });

  it('can add the cost later without changing when it was bought', async () => {
    const id = (await ask(valid())).body.id;
    const first = (await buy(id)).body;
    const later = (await call(markPurchaseBought, id, { cost: '4' })).body;
    expect(later.cost).toBe('4.00');
    expect(new Date(later.handledAt).getTime()).toBe(new Date(first.handledAt).getTime());
  });

  it('turns a request down only with a reason, which the requester sees', async () => {
    const id = (await ask(valid())).body.id;
    expect((await call(markPurchaseNotBuying, id, { reason: '' })).statusCode).toBe(400);
    const r = await call(markPurchaseNotBuying, id, { reason: 'We still have 3 boxes in the store room' });
    expect(r.body).toMatchObject({ status: 'NOT_BUYING', declineReason: 'We still have 3 boxes in the store room' });
    expect((await list()).notBuying).toHaveLength(1);
  });

  it('puts a mis-ticked item back on the list, clearing its cost and receipt', async () => {
    const id = (await ask(valid())).body.id;
    const file = receiptFile();
    await buy(id, { cost: '5' }, [file]);
    const r = await call(returnPurchaseToList, id);
    expect(r.body).toMatchObject({ status: 'APPROVED', cost: null, receipt: null, handledAt: null }); // stays approved
    await new Promise(done => setTimeout(done, 50)); // file removal is fire-and-forget
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it('lets the supervisor add a note the requester sees, and clear it again', async () => {
    const id = (await ask(valid())).body.id;
    const noted = await call(setPurchaseNote, id, { note: 'Out of stock at MR DIY — trying again next week' });
    expect(noted.body).toMatchObject({ supervisorNote: 'Out of stock at MR DIY — trying again next week', supervisorNoteByName: 'Ada Admin', status: 'REQUESTED' });
    const mine = res();
    await listMyPurchaseRequests(reqWith({ user: TEACHER }), mine);
    expect(mine.body[0].supervisorNote).toBe('Out of stock at MR DIY — trying again next week');
    const cleared = await call(setPurchaseNote, id, { note: '  ' });
    expect(cleared.body).toMatchObject({ supervisorNote: null, supervisorNoteByName: null });
  });

  it('keeps a record of every step — who asked, who ticked, who unticked — even after an undo', async () => {
    const id = (await ask(valid())).body.id;
    await buy(id, { cost: '5' });
    await call(returnPurchaseToList, id);
    await call(markPurchaseNotBuying, id, { reason: 'Found some in the store room' });
    const kinds = (await db.select().from(purchaseRequestLogs).where(eq(purchaseRequestLogs.purchaseRequestId, id)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(l => `${l.kind}:${l.authorName}`);
    expect(kinds).toEqual([
      'REQUESTED:Tina Teacher', 'APPROVED:Ada Admin', 'BOUGHT:Ada Admin', 'COST:Ada Admin', 'BACK_TO_LIST:Ada Admin', 'NOT_BUYING:Ada Admin',
    ]);
  });

  it('shows the requester the record of their request, but not the price', async () => {
    const id = (await ask(valid())).body.id;
    await buy(id, { cost: '9.90' });
    const mine = res();
    await listMyPurchaseRequests(reqWith({ user: TEACHER }), mine);
    expect(mine.body[0].history.map((h: { kind: string }) => h.kind)).toEqual(['REQUESTED', 'APPROVED', 'BOUGHT']);
    expect(JSON.stringify(mine.body)).not.toContain('9.90');
  });

  it('keeps a past week\'s record of what was on its list but not bought', async () => {
    const lastWeek = new Date(Date.now() - 7 * DAY_MS);
    const stillWaiting = (await ask({ ...valid(), item: 'Crayons' })).body.id;
    const boughtLater = (await ask({ ...valid(), item: 'Tissue' })).body.id;
    const boughtThen = (await ask({ ...valid(), item: 'Glue' })).body.id;
    await db.update(purchaseRequests).set({ createdAt: lastWeek }).where(eq(purchaseRequests.requestedByUserId, TEACHER.id));
    await buy(boughtLater); // bought this week, so it waited through last week
    await buy(boughtThen);
    await db.update(purchaseRequests).set({ handledAt: lastWeek }).where(eq(purchaseRequests.id, boughtThen));

    const past = await list(weekStartOf(lastWeek));
    expect(past.carriedOver.map((r: { id: string }) => r.id).sort()).toEqual([stillWaiting, boughtLater].sort());
    expect(past.bought.map((r: { id: string }) => r.id)).toEqual([boughtThen]);
  });

  it('won\'t let an item be ticked bought until it is approved', async () => {
    const id = (await ask(valid())).body.id;
    expect((await call(markPurchaseBought, id)).statusCode).toBe(409);
    expect((await call(approvePurchase, id)).body).toMatchObject({ status: 'APPROVED' });
    expect((await call(markPurchaseBought, id)).body).toMatchObject({ status: 'BOUGHT' });
  });

  it('approves the whole list at once', async () => {
    await ask(valid());
    await ask({ ...valid(), item: 'Tissue' });
    const r = res();
    await approveAllPurchases(reqWith({ user: SUPERVISOR }), r);
    expect(r.body).toEqual({ approved: 2 });
    expect((await list()).toBuy.map((i: { status: string }) => i.status)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('lets the requester edit or withdraw their own request until it is approved — then it is locked', async () => {
    const id = (await ask(valid())).body.id;
    const asTeacher = async (fn: typeof updatePurchaseRequest, body: object = {}, user = TEACHER) => {
      const r = res();
      (r as any).end = () => r;
      await fn(reqWith({ body, params: { id }, user }), r);
      return r;
    };
    expect((await asTeacher(updatePurchaseRequest, { ...valid(), quantity: '3 boxes' }, OTHER)).statusCode).toBe(404); // not theirs
    const edited = await asTeacher(updatePurchaseRequest, { ...valid(), quantity: '3 boxes' });
    expect(edited.body).toMatchObject({ quantity: '3 boxes' });
    expect(edited.body.history.map((h: { kind: string; detail: string }) => `${h.kind}:${h.detail}`)).toContain('EDITED:Changed how many');

    await call(approvePurchase, id);
    expect((await asTeacher(updatePurchaseRequest, { ...valid(), quantity: '9' })).statusCode).toBe(409);
    expect((await asTeacher(cancelPurchaseRequest)).statusCode).toBe(409);

    await call(returnPurchaseToList, id); // supervisor takes the approval back
    expect((await asTeacher(cancelPurchaseRequest)).statusCode).toBe(204);
    expect((await list()).toBuy).toHaveLength(0);
    const [kept] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id));
    expect(kept.status).toBe('CANCELLED'); // kept for the record, hidden from the lists
  });

  it('lets a teacher who chose to buy it themselves mark it bought once approved, and see their own cost', async () => {
    const id = (await ask({ ...valid(), buyer: 'SELF' })).body.id;
    const self = async (body: object = {}, user = TEACHER) => {
      const r = res();
      const rq = reqWith({ body, params: { id }, user });
      (rq as any).files = [];
      await markBoughtMyself(rq, r);
      return r;
    };
    expect((await self()).statusCode).toBe(409); // not approved yet
    await call(approvePurchase, id);
    expect((await self({}, OTHER)).statusCode).toBe(404); // not theirs
    const bought = await self({ cost: '15.80' });
    expect(bought.body).toMatchObject({ status: 'BOUGHT', buyer: 'SELF', cost: '15.80', handledByName: 'Tina Teacher' });

    const mine = res();
    await listMyPurchaseRequests(reqWith({ user: TEACHER }), mine);
    expect(mine.body[0]).toMatchObject({ cost: '15.80', hasReceipt: false });
  });

  it('won\'t let a teacher mark bought something the supervisor is buying', async () => {
    const id = (await ask(valid())).body.id;
    await call(approvePurchase, id);
    const r = res();
    const rq = reqWith({ body: {}, params: { id }, user: TEACHER });
    (rq as any).files = [];
    await markBoughtMyself(rq, r);
    expect(r.statusCode).toBe(409);
  });

  it('shows a past week\'s purchases under that week only', async () => {
    const id = (await ask(valid())).body.id;
    await buy(id, { cost: '3' });
    const lastWeek = new Date(Date.now() - 7 * DAY_MS);
    await db.update(purchaseRequests).set({ handledAt: lastWeek }).where(eq(purchaseRequests.id, id));
    expect((await list()).bought).toHaveLength(0);
    const past = await list(weekStartOf(lastWeek));
    expect(past.weekStart).toBe(weekStartOf(lastWeek));
    expect(past.bought).toHaveLength(1);
    expect(past.spend.total).toBe(3);
  });
});
