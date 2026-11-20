import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  leads, notificationMutes, notifications, operatingCosts, packages, purchaseRequestLogs, purchaseRequests,
  studentEnrollments, students, userAuthRoles, users,
} from '../../db/schema.js';
import { createSibling, withdrawStudent } from '../../controllers/students.controller.js';
import { approvePurchase, createPurchaseRequest, markPurchaseBought } from '../../controllers/purchase-requests.controller.js';
import { bulkUpsertEntries } from '../../controllers/operatingCost.controller.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';
import { PKG, seedPackages, seedStudent } from '../fixtures/students.js';

// The Students, Finance and Analysis events, through the real handlers: each
// reaches the role that acts on it — once — and never a plain Teacher.

const NOW = new Date('2026-01-01T00:00:00Z');
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };
const TINA = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: null };
const PEOPLE = {
  frontDesk: 'builtin:FRONT_DESK_OFFICER',
  accounts: 'builtin:ACCOUNTS_EXECUTIVE',
  analyst: 'builtin:ANALYST',
  teacher: 'builtin:TEACHER',
} as const;
type Person = keyof typeof PEOPLE;

beforeEach(async () => {
  await resetTables(notifications, notificationMutes, userAuthRoles, purchaseRequestLogs, purchaseRequests, operatingCosts,
    studentEnrollments, students, leads, packages, users);
  await db.insert(users).values([
    await activeUser({ id: ADMIN.id, email: ADMIN.email, name: 'Ada Admin' }),
    await activeUser({ id: TINA.id, email: TINA.email, name: 'Tina Teacher', role: 'USER' }),
  ]);
  for (const [who, roleId] of Object.entries(PEOPLE)) {
    await db.insert(users).values(await activeUser({ id: `u-ev-${who}`, email: `${who}@kindertech.test`, name: who, role: 'USER' }));
    await db.insert(userAuthRoles).values({ id: `uar-ev-${who}`, userId: `u-ev-${who}`, authRoleId: roleId, createdAt: NOW });
  }
});
afterAll(async () => { await pool.end(); });

const inbox = async (who: Person) => (await db.select().from(notifications).where(eq(notifications.userId, `u-ev-${who}`)))
  .map(n => ({ kind: n.kind, title: n.title, link: n.link }));

describe('Notifications — Students, Finance and Analysis events', () => {
  it('a new student and a withdrawal tell the front desk, and open the student', async () => {
    await seedPackages();
    const first = await seedStudent({ enrollments: [{ start: '2025-01-01' }] });
    const r = res();
    await createSibling(reqWith({ user: ADMIN, body: {
      leadId: first.replace('stu', 'lead'), childName: 'Aisha', childDob: '2021-06-01', enrolmentYear: 2025, enrolmentMonth: 1, packageId: PKG.standard,
    } }), r);
    expect(r.statusCode).toBe(201);
    await withdrawStudent(reqWith({ user: ADMIN, params: { id: first }, body: { withdrawReason: 'Moving away' } }), res());
    await withdrawStudent(reqWith({ user: ADMIN, params: { id: first }, body: {} }), res()); // already withdrawn — no second notice
    expect(await inbox('frontDesk')).toEqual(expect.arrayContaining([
      { kind: 'NEW_STUDENT', title: 'New student: Aisha', link: `/students/${r.body.id}` },
      { kind: 'STUDENT_WITHDRAWN', title: `Student withdrawn: Child ${first.split('-')[1]}`, link: `/students/${first}` },
    ]));
    expect(await inbox('frontDesk')).toHaveLength(2);
    for (const other of ['accounts', 'analyst', 'teacher'] as const) expect(await inbox(other), other).toEqual([]);
  });

  it('an item bought with a cost tells Finance once — the first time a cost is entered', async () => {
    const asked = res();
    await createPurchaseRequest(reqWith({ user: TINA, body: { item: 'Glue sticks', quantity: '2 boxes', purpose: 'Sunflower class' } }), asked);
    const id = asked.body.id;
    const buy = async (body: object) => { const rq = reqWith({ user: ADMIN, params: { id }, body }); (rq as any).files = []; await markPurchaseBought(rq, res()); };
    await approvePurchase(reqWith({ user: ADMIN, params: { id } }), res());
    await buy({});            // ticked without a cost yet
    expect(await inbox('accounts')).toEqual([]);
    await buy({ cost: '12.50' });
    await buy({ cost: '13' }); // corrected later — not a new purchase
    expect(await inbox('accounts')).toEqual([
      { kind: 'ITEM_BOUGHT', title: 'Bought: Glue sticks × 2 boxes — RM 12.50', link: '/operations/operating-costs' },
    ]);
    for (const other of ['frontDesk', 'analyst', 'teacher'] as const) expect(await inbox(other), other).toEqual([]);
  });

  it('a month’s first operating costs tell Analysis once, and open the cost report', async () => {
    const save = (amount: number) => bulkUpsertEntries(
      reqWith({ user: ADMIN, body: { year: 2026, rows: [{ categoryId: 'cat-rent', month: 9, amount }] } }), res());
    await save(5000);
    await save(5200); // a correction to the same month
    expect(await inbox('analyst')).toEqual([
      { kind: 'COSTS_RECORDED', title: 'Operating costs recorded: October 2026', link: '/analysis/operating-cost' },
    ]);
    for (const other of ['frontDesk', 'accounts', 'teacher'] as const) expect(await inbox(other), other).toEqual([]);
  });
});
