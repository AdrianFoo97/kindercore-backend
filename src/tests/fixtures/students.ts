import { db } from '../../db/client.js';
import { leads, packages, students, studentEnrollments } from '../../db/schema.js';

// Test data builders for the Students revenue tests, typed against the real
// schema (one package per year + programme + age is a unique key). Each
// student needs a Lead (Student.leadId is a real foreign key)
// and a Package; enrolments carry the fee history revenue is computed from.

const NOW = new Date('2025-01-01T00:00:00Z');

export const PKG = { standard: 'pkg-standard', premium: 'pkg-premium' } as const;

export async function seedPackages() {
  await db.insert(packages).values([
    { id: PKG.standard, year: 2025, programme: 'Kindergarten', age: 5, name: 'Standard', price: 1000, updatedAt: NOW },
    { id: PKG.premium, year: 2025, programme: 'Kindergarten', age: 6, name: 'Premium', price: 1500, updatedAt: NOW },
  ]);
}

let seq = 0;

/**
 * One student with their enrolment periods. `dob` defaults to a 4-year-old
 * (born 2021) so the "graduates at 7" rule doesn't kick in by accident.
 */
export async function seedStudent(opts: {
  dob?: string;
  enrollments: { start: string; end?: string; pkg?: string; fee?: number; overridden?: boolean }[];
}) {
  seq += 1;
  const leadId = `lead-${seq}`;
  const studentId = `stu-${seq}`;
  await db.insert(leads).values({
    id: leadId, submittedAt: NOW, childName: `Child ${seq}`, parentPhone: `012000${String(seq).padStart(4, '0')}`,
    childDob: new Date(opts.dob ?? '2021-06-01'), enrolmentYear: 2025,
  });
  await db.insert(students).values({
    id: studentId, leadId, enrolmentYear: 2025, enrolmentMonth: 1, packageId: opts.enrollments[0].pkg ?? PKG.standard,
    enrolledAt: NOW, createdAt: NOW,
  });
  for (const [i, e] of opts.enrollments.entries()) {
    await db.insert(studentEnrollments).values({
      id: `${studentId}-e${i}`, studentId, packageId: e.pkg ?? PKG.standard,
      monthlyFee: e.fee ?? 0, feeOverridden: e.overridden ?? false,
      startDate: new Date(e.start), endDate: e.end ? new Date(e.end) : null, createdAt: NOW,
    });
  }
  return studentId;
}
