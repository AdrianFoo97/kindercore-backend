import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { packages, students, studentEnrollments } from '../db/schema.js';

// ── Shape returned to frontend ────────────────────────────────────────────────
// Mirrors `Enrollment` in kindercore-frontend/src/types/index.ts.

const enrollmentSelect = {
  id: studentEnrollments.id,
  studentId: studentEnrollments.studentId,
  packageId: studentEnrollments.packageId,
  monthlyFee: studentEnrollments.monthlyFee,
  feeOverridden: studentEnrollments.feeOverridden,
  startDate: studentEnrollments.startDate,
  endDate: studentEnrollments.endDate,
  reason: studentEnrollments.reason,
  createdAt: studentEnrollments.createdAt,
  packageName: packages.name,
  packageProgramme: packages.programme,
  packageAge: packages.age,
  packageYear: packages.year,
  packagePrice: packages.price,
};

type EnrollmentRow = Awaited<ReturnType<typeof queryEnrollments>>[number];

function queryEnrollments() {
  return db
    .select(enrollmentSelect)
    .from(studentEnrollments)
    .leftJoin(packages, eq(packages.id, studentEnrollments.packageId));
}

function reshape(row: EnrollmentRow) {
  return {
    id: row.id,
    studentId: row.studentId,
    packageId: row.packageId,
    monthlyFee: row.monthlyFee,
    feeOverridden: row.feeOverridden,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
    createdAt: row.createdAt,
    package: row.packageName ? {
      id: row.packageId,
      name: row.packageName,
      programme: row.packageProgramme,
      age: row.packageAge,
      year: row.packageYear,
      price: row.packagePrice,
    } : undefined,
  };
}

// ── GET /api/students/:id/enrollments ─────────────────────────────────────────

export async function getEnrollmentsForStudent(req: Request, res: Response): Promise<void> {
  const studentId = req.params.id;

  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

  // Newest-first by start date so the open period (endDate=null) bubbles up
  // and history reads as a timeline going backwards.
  const rows = await queryEnrollments()
    .where(eq(studentEnrollments.studentId, studentId))
    .orderBy(desc(studentEnrollments.startDate));

  res.json(rows.map(reshape));
}

// ── POST /api/students/:id/enrollments ────────────────────────────────────────
// Closes the student's current enrollment on `startDate` and opens a new
// period the same day. Past months keep their original package + fee, so
// historical revenue stays stable.

const createSchema = z.object({
  packageId: z.string().min(1),
  monthlyFee: z.number().nonnegative(),
  feeOverridden: z.boolean(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  reason: z.string().max(191).nullable().optional(),
});

export async function createEnrollment(req: Request, res: Response): Promise<void> {
  const studentId = req.params.id;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { packageId, monthlyFee, feeOverridden, startDate, reason } = parsed.data;

  const effectiveDate = new Date(startDate);

  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

  const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
  if (!pkg) { res.status(404).json({ message: 'Package not found' }); return; }

  // The current open period (if any) is the one we're closing. There should
  // only be one row with endDate=null per student — that's invariant we
  // enforce on every write.
  const [current] = await db
    .select()
    .from(studentEnrollments)
    .where(and(
      eq(studentEnrollments.studentId, studentId),
      isNull(studentEnrollments.endDate),
    ))
    .limit(1);

  if (current && effectiveDate <= current.startDate) {
    res.status(400).json({
      message: `Effective date must be after the current enrolment's start (${current.startDate.toISOString().slice(0, 10)})`,
    });
    return;
  }

  const newId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    if (current) {
      await tx.update(studentEnrollments)
        .set({ endDate: effectiveDate })
        .where(eq(studentEnrollments.id, current.id));
    }
    await tx.insert(studentEnrollments).values({
      id: newId,
      studentId,
      packageId,
      monthlyFee,
      feeOverridden,
      startDate: effectiveDate,
      endDate: null,
      reason: reason ?? null,
      createdAt: now,
    });
    // Keep Student.packageId / monthlyFee / feeOverridden in sync as a
    // denormalized "current" cache for fast list views.
    await tx.update(students)
      .set({ packageId, monthlyFee, feeOverridden })
      .where(eq(students.id, studentId));
  });

  const [row] = await queryEnrollments().where(eq(studentEnrollments.id, newId));
  res.status(201).json(reshape(row));
}

// ── PATCH /api/enrollments/:id ────────────────────────────────────────────────
// Corrects an existing period in place — for typos / data fixes, not for
// scheduling a real package change (which uses POST instead). When the
// CURRENT period is corrected, Student.* cache is updated to match.

const updateSchema = z.object({
  packageId: z.string().min(1).optional(),
  monthlyFee: z.number().nonnegative().optional(),
  feeOverridden: z.boolean().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().max(191).nullable().optional(),
});

export async function updateEnrollment(req: Request, res: Response): Promise<void> {
  const enrollmentId = req.params.id;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(studentEnrollments).where(eq(studentEnrollments.id, enrollmentId)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Enrollment not found' }); return; }

  const updates: Record<string, unknown> = {};
  if (parsed.data.packageId !== undefined)     updates.packageId = parsed.data.packageId;
  if (parsed.data.monthlyFee !== undefined)    updates.monthlyFee = parsed.data.monthlyFee;
  if (parsed.data.feeOverridden !== undefined) updates.feeOverridden = parsed.data.feeOverridden;
  if (parsed.data.startDate !== undefined)     updates.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate !== undefined)       updates.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (parsed.data.reason !== undefined)        updates.reason = parsed.data.reason;

  await db.transaction(async (tx) => {
    await tx.update(studentEnrollments).set(updates).where(eq(studentEnrollments.id, enrollmentId));
    // If we just corrected the CURRENT period, update the Student cache too.
    const isCurrent = existing.endDate === null && updates.endDate === undefined;
    if (isCurrent) {
      const cacheUpdates: Record<string, unknown> = {};
      if (updates.packageId !== undefined)     cacheUpdates.packageId = updates.packageId;
      if (updates.monthlyFee !== undefined)    cacheUpdates.monthlyFee = updates.monthlyFee;
      if (updates.feeOverridden !== undefined) cacheUpdates.feeOverridden = updates.feeOverridden;
      if (Object.keys(cacheUpdates).length > 0) {
        await tx.update(students).set(cacheUpdates).where(eq(students.id, existing.studentId));
      }
    }
  });

  const [row] = await queryEnrollments().where(eq(studentEnrollments.id, enrollmentId));
  res.json(reshape(row));
}

// ── DELETE /api/enrollments/:id ───────────────────────────────────────────────
// Admin-only edge case (e.g. an enrollment was created by mistake). Refuses
// to delete the current open period because that would leave the student
// in a broken "no active enrollment" state.

export async function deleteEnrollment(req: Request, res: Response): Promise<void> {
  const enrollmentId = req.params.id;

  const [existing] = await db.select().from(studentEnrollments).where(eq(studentEnrollments.id, enrollmentId)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Enrollment not found' }); return; }

  if (existing.endDate === null) {
    res.status(400).json({ message: 'Cannot delete the current open enrolment. Close it first or pick another row.' });
    return;
  }

  await db.delete(studentEnrollments).where(eq(studentEnrollments.id, enrollmentId));
  res.status(204).end();
}
