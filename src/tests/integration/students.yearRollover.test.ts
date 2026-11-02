import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import { leads, packages, students, studentEnrollments } from '../../db/schema.js';
import { rolloverYear, undoRolloverYear } from '../../services/rollover.service.js';
import { resetTables } from './testDb.js';
import { seedPackages, seedStudent, PKG } from '../fixtures/students.js';

// Year rollover (Settings → Year Rollover) runs once a year and moves every
// child onto next year's package for their new age — it sets every fee for
// the year. Packages in the fixture: 2025 Kindergarten age 5 "Standard"
// RM 1,000, age 6 "Premium" RM 1,500.

const NEW_YEAR = new Date(2026, 0, 1);

beforeEach(async () => {
  await resetTables(studentEnrollments, students, leads, packages);
  await seedPackages();
});
afterAll(async () => { await pool.end(); });

/** A child on a 2025 package, with the Student row's fee cache matching their enrolment. */
async function child(dob: string, opts: { pkg?: string; fee?: number; overridden?: boolean } = {}) {
  const fee = opts.fee ?? 1000;
  const id = await seedStudent({ dob, enrollments: [{ start: '2025-01-01', pkg: opts.pkg ?? PKG.standard, fee, overridden: opts.overridden }] });
  await db.update(students).set({ monthlyFee: fee, feeOverridden: opts.overridden ?? false }).where(eq(students.id, id));
  return id;
}
const periods = (studentId: string) =>
  db.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, studentId)).orderBy(asc(studentEnrollments.startDate));
const studentRow = async (id: string) => (await db.select().from(students).where(eq(students.id, id)))[0];
const pkg2026 = async (age: number) =>
  (await db.select().from(packages).where(and(eq(packages.year, 2026), eq(packages.age, age))))[0];

/** Everything rollover touches on children, for before/after comparison. */
async function snapshot() {
  const enr = await db.select().from(studentEnrollments).orderBy(asc(studentEnrollments.id));
  const stu = await db.select().from(students).orderBy(asc(students.id));
  return {
    enrollments: enr.map(e => ({ id: e.id, packageId: e.packageId, monthlyFee: e.monthlyFee, feeOverridden: e.feeOverridden, start: e.startDate.getTime(), end: e.endDate?.getTime() ?? null, reason: e.reason })),
    students: stu.map(s => ({ id: s.id, packageId: s.packageId, monthlyFee: s.monthlyFee, feeOverridden: s.feeOverridden, withdrawnAt: s.withdrawnAt?.getTime() ?? null, withdrawReason: s.withdrawReason })),
  };
}

describe('Students — year rollover', () => {
  it('moves a child onto next year\'s package for their new age, at that package\'s price', async () => {
    const id = await child('2020-06-01'); // turns 6 in 2026
    const summary = await rolloverYear(2026);
    expect(summary.rolledOver).toHaveLength(1);

    const premium2026 = await pkg2026(6);
    const [old, next] = await periods(id);
    expect(old.endDate?.getTime()).toBe(NEW_YEAR.getTime());
    expect(next).toMatchObject({ packageId: premium2026.id, monthlyFee: 1500, endDate: null, reason: 'Year rollover' });
    expect(next.startDate.getTime()).toBe(NEW_YEAR.getTime());
    expect(await studentRow(id)).toMatchObject({ packageId: premium2026.id, monthlyFee: 1500 });
  });

  it('keeps a custom (discounted) fee exactly as it was', async () => {
    const id = await child('2020-06-01', { fee: 800, overridden: true });
    await rolloverYear(2026);
    const [, next] = await periods(id);
    expect(next).toMatchObject({ monthlyFee: 800, feeOverridden: true });
  });

  it('copies last year\'s packages into the new year, but uses a new-year price already set', async () => {
    await db.insert(packages).values({ id: 'pkg-2026-5', year: 2026, programme: 'Kindergarten', age: 5, name: 'Standard 2026', price: 1100, updatedAt: new Date() });
    const id = await child('2021-06-01'); // turns 5 in 2026
    const summary = await rolloverYear(2026);
    expect(summary.packagesCreated.map(p => p.age)).toEqual([6]); // age 5 already existed
    expect((await periods(id))[1]).toMatchObject({ packageId: 'pkg-2026-5', monthlyFee: 1100 });
  });

  it('graduates a child turning 7: closes their place and stops their fees', async () => {
    const id = await child('2019-03-01', { pkg: PKG.premium, fee: 1500 });
    const summary = await rolloverYear(2026);
    expect(summary.graduated).toHaveLength(1);
    const all = await periods(id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ reason: 'Graduated' });
    expect(all[0].endDate?.getTime()).toBe(NEW_YEAR.getTime());
    expect(await studentRow(id)).toMatchObject({ withdrawReason: 'Graduated' });
  });

  it('leaves children who have already withdrawn alone', async () => {
    const id = await child('2020-06-01');
    await db.update(students).set({ withdrawnAt: new Date(2025, 5, 1) }).where(eq(students.id, id));
    await rolloverYear(2026);
    expect(await periods(id)).toHaveLength(1);
  });

  it('reports a child it can\'t place instead of guessing, and leaves them untouched', async () => {
    const id = await child('2022-06-01'); // turns 4 — no age-4 package exists
    const summary = await rolloverYear(2026);
    expect(summary.skipped).toEqual([expect.objectContaining({ studentId: id, reason: 'No 2026 Kindergarten package for age 4' })]);
    const all = await periods(id);
    expect(all).toHaveLength(1);
    expect(all[0].endDate).toBeNull();
  });

  it('is safe to run twice — the second run changes nothing', async () => {
    await child('2020-06-01');
    await child('2019-03-01', { pkg: PKG.premium, fee: 1500 });
    await rolloverYear(2026);
    const after = await snapshot();
    const again = await rolloverYear(2026);
    expect([again.rolledOver.length, again.graduated.length, again.packagesCreated.length]).toEqual([0, 0, 0]);
    expect(await snapshot()).toEqual(after);
  });

  it('a preview (dry run) changes nothing but reports what would happen', async () => {
    await child('2020-06-01');
    const before = await snapshot();
    const preview = await rolloverYear(2026, { dryRun: true });
    expect(preview.rolledOver).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
    expect(await pkg2026(6)).toBeUndefined();
  });

  it('undo puts every child back exactly as they were', async () => {
    await child('2020-06-01');                                   // moves up
    await child('2020-09-01', { fee: 800, overridden: true });   // moves up on a custom fee
    await child('2019-03-01', { pkg: PKG.premium, fee: 1500 });  // graduates
    const before = await snapshot();

    await rolloverYear(2026);
    expect(await snapshot()).not.toEqual(before);
    const undo = await undoRolloverYear(2026);
    expect([undo.reopened.length, undo.ungraduated.length, undo.skipped.length]).toEqual([2, 1, 0]);
    expect(await snapshot()).toEqual(before);
  });
});
