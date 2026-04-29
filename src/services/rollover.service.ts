import { randomUUID } from 'crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { packages, students, studentEnrollments, leads } from '../db/schema.js';

// Year rollover: closes every active student's current enrollment on
// Dec 31 of the source year and opens a new one on Jan 1 of the target year
// using the matching (programme, age) package for the student's new age.
//
// 1. Packages: each source-year package is cloned into target-year if a
//    matching (programme, age) row doesn't already exist. Same price, same
//    naming pattern (year prefix swapped if present).
// 2. Students that turn 7 in the target year are "Graduated" — their
//    current enrollment is closed with reason="Graduated" and no new period
//    is opened (revenue stops).
// 3. Students whose required (programme, age) target package can't be
//    found are skipped and reported back to the admin.
// 4. The Student.packageId / monthlyFee denormalised cache is updated
//    in lock-step with the new enrollment.
//
// Idempotent: safe to re-run. Students already on a target-year package
// are skipped. Cloned packages are skipped if already present.

export interface RolloverSummary {
  targetYear: number;
  /** Packages newly created in target year. */
  packagesCreated: { id: string; programme: string; age: number; price: number | null; name: string }[];
  /** Students moved onto a target-year enrollment. */
  rolledOver: { studentId: string; childName: string; fromPackage: string; toPackage: string }[];
  /** Students closed out as graduated (age >= 7 in target year). */
  graduated: { studentId: string; childName: string; fromPackage: string; age: number }[];
  /** Students that couldn't be processed (missing package, no current enrollment, etc.). */
  skipped: { studentId: string; childName: string; reason: string }[];
}

interface StudentRow {
  id: string;
  packageId: string | null;
  feeOverridden: boolean;
  studentChildDob: Date | null;
  studentChildName: string | null;
  leadChildDob: Date | null;
  leadChildName: string | null;
  withdrawnAt: Date | null;
}

export async function rolloverYear(targetYear: number, opts?: { dryRun?: boolean }): Promise<RolloverSummary> {
  const sourceYear = targetYear - 1;
  const dryRun = !!opts?.dryRun;

  const summary: RolloverSummary = {
    targetYear,
    packagesCreated: [],
    rolledOver: [],
    graduated: [],
    skipped: [],
  };

  const now = new Date();
  // The boundary date: source-year period ends and target-year period starts
  // here. The end of the source year is exclusive (`endDate` is exclusive in
  // our model), so a single `boundary = Jan 1 of target year` works for
  // both: the closing period gets endDate=boundary, the new period gets
  // startDate=boundary.
  const boundary = new Date(targetYear, 0, 1);

  // ── Phase 1: clone source-year packages into target-year ─────────────
  const sourcePkgs = await db.select().from(packages).where(eq(packages.year, sourceYear));
  const targetPkgs = await db.select().from(packages).where(eq(packages.year, targetYear));
  const targetPkgKey = new Map<string, typeof targetPkgs[number]>();
  for (const p of targetPkgs) {
    targetPkgKey.set(`${p.programme}__${p.age}`, p);
  }

  for (const sp of sourcePkgs) {
    const key = `${sp.programme}__${sp.age}`;
    if (targetPkgKey.has(key)) continue;
    const newId = randomUUID();
    const renamed = sp.name.includes(String(sourceYear))
      ? sp.name.replace(String(sourceYear), String(targetYear))
      : sp.name;
    const newPkg = {
      id: newId,
      year: targetYear,
      programme: sp.programme,
      age: sp.age,
      name: renamed,
      price: sp.price,
      updatedAt: now,
    };
    if (!dryRun) {
      await db.insert(packages).values(newPkg);
    }
    targetPkgKey.set(key, newPkg as any);
    summary.packagesCreated.push({
      id: newId,
      programme: sp.programme,
      age: sp.age,
      price: sp.price,
      name: renamed,
    });
  }

  // ── Phase 2: roll over each student ─────────────────────────────────
  const rows: StudentRow[] = await db
    .select({
      id: students.id,
      packageId: students.packageId,
      feeOverridden: students.feeOverridden,
      studentChildDob: students.childDob,
      studentChildName: students.childName,
      leadChildDob: leads.childDob,
      leadChildName: leads.childName,
      withdrawnAt: students.withdrawnAt,
    })
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id));

  for (const row of rows) {
    const childName = row.studentChildName ?? row.leadChildName ?? '(unknown)';
    if (row.withdrawnAt) continue; // already withdrawn — leave them alone

    // Look up current open enrollment.
    const [currentEnr] = await db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.studentId, row.id), isNull(studentEnrollments.endDate)))
      .limit(1);
    if (!currentEnr) {
      summary.skipped.push({ studentId: row.id, childName, reason: 'No open enrollment' });
      continue;
    }

    const [currentPkg] = await db.select().from(packages).where(eq(packages.id, currentEnr.packageId)).limit(1);
    if (!currentPkg) {
      summary.skipped.push({ studentId: row.id, childName, reason: 'Current package not found' });
      continue;
    }
    if (currentPkg.year >= targetYear) continue; // already on a current/future-year package

    // Compute the student's age in the target year (year-of-target − birth year).
    const dob = row.studentChildDob ?? row.leadChildDob;
    if (!dob) {
      summary.skipped.push({ studentId: row.id, childName, reason: 'No DOB on file' });
      continue;
    }
    const newAge = targetYear - dob.getFullYear();

    // Graduates (turning 7 or older in target year): close the current
    // enrollment, no new period.
    if (newAge >= 7) {
      if (!dryRun) {
        await db.update(studentEnrollments)
          .set({ endDate: boundary, reason: 'Graduated' })
          .where(eq(studentEnrollments.id, currentEnr.id));
        await db.update(students)
          .set({ withdrawnAt: boundary, withdrawReason: 'Graduated' })
          .where(eq(students.id, row.id));
      }
      summary.graduated.push({
        studentId: row.id,
        childName,
        fromPackage: currentPkg.name,
        age: newAge,
      });
      continue;
    }

    // Find the matching target-year package for the student's new age class.
    const targetPkg = targetPkgKey.get(`${currentPkg.programme}__${newAge}`);
    if (!targetPkg) {
      summary.skipped.push({
        studentId: row.id,
        childName,
        reason: `No ${targetYear} ${currentPkg.programme} package for age ${newAge}`,
      });
      continue;
    }

    // Carry forward the student's fee override exactly as-is. If they were
    // on the package's standard price, switch to the new package's price.
    const newMonthlyFee = currentEnr.feeOverridden
      ? currentEnr.monthlyFee
      : (targetPkg.price ?? currentEnr.monthlyFee);

    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx.update(studentEnrollments)
          .set({ endDate: boundary })
          .where(eq(studentEnrollments.id, currentEnr.id));
        await tx.insert(studentEnrollments).values({
          id: randomUUID(),
          studentId: row.id,
          packageId: targetPkg.id,
          monthlyFee: newMonthlyFee,
          feeOverridden: currentEnr.feeOverridden,
          startDate: boundary,
          endDate: null,
          reason: 'Year rollover',
          createdAt: now,
        });
        await tx.update(students)
          .set({ packageId: targetPkg.id, monthlyFee: newMonthlyFee })
          .where(eq(students.id, row.id));
      });
    }

    summary.rolledOver.push({
      studentId: row.id,
      childName,
      fromPackage: currentPkg.name,
      toPackage: targetPkg.name,
    });
  }

  return summary;
}

// ── Repair "stuck" students ───────────────────────────────────────────
// A student is "stuck on a rollover" if they have exactly ONE enrollment
// row, that row starts on Jan 1 of `targetYear`, and they enrolled
// (Student.enrolledAt) before that boundary. They predate the rollover but
// their previous-year enrollment is missing — usually because the rollover
// undo deleted both rows, or the previous row was never created. Either
// way, the fix is to switch them onto the matching previous-year package.
//
// We don't backdate the enrollment's startDate — the boundary remains the
// row's start. That keeps revenue calculations honest (no claiming revenue
// for months we don't have data for) and lets the admin manually adjust
// the date if they want.

export interface RolloverRepairSummary {
  targetYear: number;
  fixed: { studentId: string; childName: string; fromPackage: string; toPackage: string }[];
  skipped: { studentId: string; childName: string; reason: string }[];
}

export async function repairStuckRollovers(
  targetYear: number,
  opts?: { dryRun?: boolean },
): Promise<RolloverRepairSummary> {
  const sourceYear = targetYear - 1;
  const dryRun = !!opts?.dryRun;
  const boundary = new Date(targetYear, 0, 1);
  const summary: RolloverRepairSummary = { targetYear, fixed: [], skipped: [] };

  // Pull every open enrollment whose startDate is exactly the boundary —
  // these are the candidates for a stuck rollover.
  const candidates = await db
    .select()
    .from(studentEnrollments)
    .where(isNull(studentEnrollments.endDate));

  for (const enr of candidates) {
    if (enr.startDate.getTime() !== boundary.getTime()) continue;

    const [studentRow] = await db.select().from(students).where(eq(students.id, enr.studentId)).limit(1);
    if (!studentRow) continue;
    const childName = studentRow.childName ?? '(unknown)';

    // Confirm the student predates the boundary. New post-rollover students
    // legitimately start on Jan 1 with no history — don't touch them.
    if (studentRow.enrolledAt >= boundary) continue;

    const [currentPkg] = await db.select().from(packages).where(eq(packages.id, enr.packageId)).limit(1);
    if (!currentPkg) {
      summary.skipped.push({ studentId: enr.studentId, childName, reason: 'Current package not found' });
      continue;
    }
    if (currentPkg.year !== targetYear) continue; // not on target year — not stuck

    // Pull every enrollment row this student has, sorted newest-first.
    const allForStudent = await db
      .select()
      .from(studentEnrollments)
      .where(eq(studentEnrollments.studentId, enr.studentId))
      .orderBy(desc(studentEnrollments.startDate));

    const otherClosed = allForStudent.filter(e => e.id !== enr.id && e.endDate !== null);

    if (otherClosed.length > 0) {
      // ── Has history: reopen the most recent closed period ───────────
      // (force-undo style — works regardless of `reason` field, which is
      // why Undo can miss these.)
      const previous = otherClosed[0];
      const [prevPkg] = await db.select().from(packages).where(eq(packages.id, previous.packageId)).limit(1);

      if (!dryRun) {
        await db.transaction(async (tx) => {
          await tx.delete(studentEnrollments).where(eq(studentEnrollments.id, enr.id));
          await tx.update(studentEnrollments).set({ endDate: null }).where(eq(studentEnrollments.id, previous.id));
          await tx.update(students).set({
            packageId: previous.packageId,
            monthlyFee: previous.monthlyFee,
            feeOverridden: previous.feeOverridden,
          }).where(eq(students.id, enr.studentId));
        });
      }
      summary.fixed.push({
        studentId: enr.studentId,
        childName,
        fromPackage: currentPkg.name,
        toPackage: prevPkg?.name ?? '(reopened previous period)',
      });
      continue;
    }

    // ── No history: look up year-1 (programme, age-1) package ─────────
    const [sourcePkg] = await db.select().from(packages).where(and(
      eq(packages.year, sourceYear),
      eq(packages.programme, currentPkg.programme),
      eq(packages.age, currentPkg.age - 1),
    )).limit(1);
    if (!sourcePkg) {
      summary.skipped.push({
        studentId: enr.studentId,
        childName,
        reason: `No ${sourceYear} ${currentPkg.programme} package for age ${currentPkg.age - 1}`,
      });
      continue;
    }

    const newFee = enr.feeOverridden ? enr.monthlyFee : (sourcePkg.price ?? enr.monthlyFee);

    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx.update(studentEnrollments).set({
          packageId: sourcePkg.id,
          monthlyFee: newFee,
          reason: 'Repair: stuck rollover',
        }).where(eq(studentEnrollments.id, enr.id));
        await tx.update(students).set({
          packageId: sourcePkg.id,
          monthlyFee: newFee,
        }).where(eq(students.id, enr.studentId));
      });
    }

    summary.fixed.push({
      studentId: enr.studentId,
      childName,
      fromPackage: currentPkg.name,
      toPackage: sourcePkg.name,
    });
  }

  return summary;
}

// ── Undo ──────────────────────────────────────────────────────────────
// Reverses a previous rolloverYear(targetYear) call. Heuristic:
//   - Any enrollment with reason='Year rollover' AND startDate=boundary
//     was created by the rollover. Delete it, then re-open the period
//     that was closed at the same boundary (set endDate=null) and restore
//     the Student's denormalised cache.
//   - Any enrollment with reason='Graduated' AND endDate=boundary was
//     closed by the rollover for a student turning 7. Re-open it and
//     clear Student.withdrawnAt/withdrawReason if they match.
//
// Caveat: this works cleanly only if no manual edits happened after the
// rollover — manual changes on a rolled-over student's data may be lost.
// The frontend warns the admin about this before invoking.

export interface RolloverUndoSummary {
  targetYear: number;
  /** Students whose new target-year enrollment was deleted and previous
   *  period reopened. */
  reopened: { studentId: string; childName: string; restoredPackage: string }[];
  /** Graduated students whose enrollment was reopened and withdrawal cleared. */
  ungraduated: { studentId: string; childName: string; restoredPackage: string }[];
  /** Students that couldn't be undone for some reason (no matching previous
   *  period found, etc.) — admin needs to fix manually. */
  skipped: { studentId: string; childName: string; reason: string }[];
}

export async function undoRolloverYear(targetYear: number): Promise<RolloverUndoSummary> {
  const boundary = new Date(targetYear, 0, 1);
  const summary: RolloverUndoSummary = { targetYear, reopened: [], ungraduated: [], skipped: [] };

  // Helper: load child name (student override first, fall back to lead).
  const childNameOf = async (studentId: string): Promise<string> => {
    const [r] = await db
      .select({
        sName: students.childName,
        lName: leads.childName,
      })
      .from(students)
      .leftJoin(leads, eq(students.leadId, leads.id))
      .where(eq(students.id, studentId))
      .limit(1);
    return r?.sName ?? r?.lName ?? '(unknown)';
  };

  // ── Phase 1: undo regular rollovers ──────────────────────────────────
  // The created enrollments have reason='Year rollover' and startDate
  // exactly at the boundary. We don't filter on a Drizzle-typed equals
  // because dates with millisecond precision may not match across boots
  // exactly; instead pull all by reason and filter in JS.
  const rolloverCreated = await db.select().from(studentEnrollments)
    .where(eq(studentEnrollments.reason, 'Year rollover'));
  const matchingCreated = rolloverCreated.filter(e => e.startDate.getTime() === boundary.getTime());

  for (const created of matchingCreated) {
    const childName = await childNameOf(created.studentId);

    // Find the period that was closed at the boundary for this student
    // (the one we want to reopen).
    const closed = await db.select().from(studentEnrollments)
      .where(eq(studentEnrollments.studentId, created.studentId));
    const previous = closed.find(e =>
      e.id !== created.id
      && e.endDate !== null
      && e.endDate.getTime() === boundary.getTime()
      && e.reason !== 'Graduated',
    );

    if (!previous) {
      summary.skipped.push({
        studentId: created.studentId,
        childName,
        reason: 'Could not find pre-rollover period to reopen',
      });
      continue;
    }

    const [previousPkg] = await db.select().from(packages).where(eq(packages.id, previous.packageId)).limit(1);

    await db.transaction(async (tx) => {
      await tx.delete(studentEnrollments).where(eq(studentEnrollments.id, created.id));
      await tx.update(studentEnrollments).set({ endDate: null }).where(eq(studentEnrollments.id, previous.id));
      await tx.update(students).set({
        packageId: previous.packageId,
        monthlyFee: previous.monthlyFee,
        feeOverridden: previous.feeOverridden,
      }).where(eq(students.id, created.studentId));
    });

    summary.reopened.push({
      studentId: created.studentId,
      childName,
      restoredPackage: previousPkg?.name ?? previous.packageId,
    });
  }

  // ── Phase 2: undo graduations ────────────────────────────────────────
  const graduated = await db.select().from(studentEnrollments)
    .where(eq(studentEnrollments.reason, 'Graduated'));
  const matchingGrads = graduated.filter(e => e.endDate !== null && e.endDate.getTime() === boundary.getTime());

  for (const grad of matchingGrads) {
    const childName = await childNameOf(grad.studentId);
    const [pkg] = await db.select().from(packages).where(eq(packages.id, grad.packageId)).limit(1);

    await db.transaction(async (tx) => {
      // Reopen the enrollment (clear endDate + reason).
      await tx.update(studentEnrollments)
        .set({ endDate: null, reason: null })
        .where(eq(studentEnrollments.id, grad.id));

      // Clear the Student-level "withdrawn" mark only if it was set by this
      // rollover (date matches and reason='Graduated').
      const [studentRow] = await tx.select().from(students).where(eq(students.id, grad.studentId)).limit(1);
      if (studentRow
        && studentRow.withdrawnAt?.getTime() === boundary.getTime()
        && studentRow.withdrawReason === 'Graduated'
      ) {
        await tx.update(students)
          .set({ withdrawnAt: null, withdrawReason: null })
          .where(eq(students.id, grad.studentId));
      }
    });

    summary.ungraduated.push({
      studentId: grad.studentId,
      childName,
      restoredPackage: pkg?.name ?? grad.packageId,
    });
  }

  return summary;
}
