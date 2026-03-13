import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, packages, students, systemSettings } from '../db/schema.js';

// ── Shared select + reshape ───────────────────────────────────────────────────

const studentSelect = {
  id: students.id,
  leadId: students.leadId,
  enrolmentYear: students.enrolmentYear,
  enrolmentMonth: students.enrolmentMonth,
  packageId: students.packageId,
  enrolledAt: students.enrolledAt,
  notes: students.notes,
  onboardingProgress: students.onboardingProgress,
  onboardingCompleted: students.onboardingCompleted,
  withdrawnAt: students.withdrawnAt,
  withdrawReason: students.withdrawReason,
  createdAt: students.createdAt,
  leadChildName: leads.childName,
  leadChildDob: leads.childDob,
  leadParentPhone: leads.parentPhone,
  packageName: packages.name,
  packageProgramme: packages.programme,
  packageAge: packages.age,
  packageYear: packages.year,
};

function queryStudents() {
  return db
    .select(studentSelect)
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id))
    .leftJoin(packages, eq(students.packageId, packages.id));
}

function reshape(row: typeof studentSelect extends Record<string, any> ? any : never) {
  return {
    id: row.id,
    leadId: row.leadId,
    enrolmentYear: row.enrolmentYear,
    enrolmentMonth: row.enrolmentMonth,
    packageId: row.packageId,
    enrolledAt: row.enrolledAt,
    notes: row.notes,
    onboardingProgress: row.onboardingProgress,
    onboardingCompleted: row.onboardingCompleted,
    withdrawnAt: row.withdrawnAt,
    withdrawReason: row.withdrawReason,
    createdAt: row.createdAt,
    lead: {
      childName: row.leadChildName,
      childDob: row.leadChildDob,
      parentPhone: row.leadParentPhone,
    },
    package: {
      name: row.packageName,
      programme: row.packageProgramme,
      age: row.packageAge,
      year: row.packageYear,
    },
  };
}

// ── List all students ─────────────────────────────────────────────────────────

export async function getStudents(_req: Request, res: Response): Promise<void> {
  const rows = await queryStudents().orderBy(desc(students.enrolledAt));
  res.json(rows.map(reshape));
}

// ── Create student (enrol a lead) ─────────────────────────────────────────────

const createSchema = z.object({
  leadId: z.string().min(1),
  enrolmentYear: z.number().int().min(2000).max(2100),
  enrolmentMonth: z.number().int().min(1).max(12),
  packageId: z.string().min(1),
  enrolledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export async function createStudent(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { leadId, enrolmentYear, enrolmentMonth, packageId, enrolledAt, notes } = parsed.data;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }

  const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
  if (!pkg) { res.status(404).json({ message: 'Package not found' }); return; }

  const [existingStudent] = await db.select().from(students).where(eq(students.leadId, leadId)).limit(1);
  if (existingStudent) { res.status(409).json({ message: 'Student already exists for this lead' }); return; }

  const [settingRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'onboarding_tasks')).limit(1);
  const tasks = Array.isArray(settingRow?.value) ? (settingRow!.value as string[]) : [];
  const onboardingProgress = tasks.map((task: string) => ({ task, done: false }));

  const now = new Date();
  const newId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(students).values({
      id: newId,
      leadId,
      enrolmentYear,
      enrolmentMonth,
      packageId,
      enrolledAt: enrolledAt ? new Date(enrolledAt) : now,
      notes: notes ?? null,
      onboardingProgress,
      createdAt: now,
    });
    await tx.update(leads).set({ status: 'ENROLLED' }).where(eq(leads.id, leadId));
  });

  const [row] = await queryStudents().where(eq(students.id, newId));
  res.status(201).json(reshape(row));
}

// ── Update student ────────────────────────────────────────────────────────────

const updateSchema = z.object({
  enrolmentYear: z.number().int().min(2000).max(2100).optional(),
  enrolmentMonth: z.number().int().min(1).max(12).optional(),
  packageId: z.string().min(1).optional(),
  enrolledAt: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  childName: z.string().min(1).optional(),
  parentPhone: z.string().min(1).optional(),
});

export async function updateStudent(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  const { enrolmentYear, enrolmentMonth, packageId, enrolledAt, notes, childDob, childName, parentPhone } = parsed.data;

  const leadUpdate: Record<string, unknown> = {};
  if (childDob !== undefined) leadUpdate.childDob = new Date(childDob);
  if (childName !== undefined) leadUpdate.childName = childName;
  if (parentPhone !== undefined) leadUpdate.parentPhone = parentPhone;

  await db.transaction(async (tx) => {
    await tx.update(students).set({
      ...(enrolmentYear !== undefined ? { enrolmentYear } : {}),
      ...(enrolmentMonth !== undefined ? { enrolmentMonth } : {}),
      ...(packageId !== undefined ? { packageId } : {}),
      ...(enrolledAt !== undefined ? { enrolledAt: new Date(enrolledAt) } : {}),
      ...(notes !== undefined ? { notes } : {}),
    }).where(eq(students.id, id));

    if (Object.keys(leadUpdate).length > 0) {
      await tx.update(leads).set(leadUpdate as any).where(eq(leads.id, existing.leadId));
    }
  });

  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(reshape(row));
}

// ── Complete onboarding ───────────────────────────────────────────────────────

export async function completeOnboarding(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  const progress = existing.onboardingProgress as Array<{ task: string; done: boolean }> | null;
  if (!progress || progress.length === 0 || progress.some(t => !t.done)) {
    res.status(400).json({ message: 'All onboarding tasks must be completed first' });
    return;
  }

  await db.update(students).set({ onboardingCompleted: true }).where(eq(students.id, id));
  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(reshape(row));
}

// ── Delete student ────────────────────────────────────────────────────────────

export async function resetAllStudents(_req: Request, res: Response): Promise<void> {
  await db.delete(students);
  res.json({ message: 'All students deleted' });
}

export async function deleteStudent(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  await db.transaction(async (tx) => {
    await tx.delete(students).where(eq(students.id, id));
    await tx.update(leads).set({ status: 'LOST' }).where(eq(leads.id, existing.leadId));
  });

  res.status(204).end();
}

// ── Withdraw student ──────────────────────────────────────────────────────────

const withdrawSchema = z.object({
  withdrawnAt: z.string().datetime().optional(),
  withdrawReason: z.string().optional(),
});

export async function withdrawStudent(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  const { withdrawnAt, withdrawReason } = parsed.data;
  await db.update(students).set({
    withdrawnAt: withdrawnAt ? new Date(withdrawnAt) : new Date(),
    withdrawReason: withdrawReason ?? null,
  }).where(eq(students.id, id));

  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(reshape(row));
}

// ── Reactivate student (undo withdrawal) ──────────────────────────────────────

export async function reactivateStudent(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }
  if (!existing.withdrawnAt) { res.status(400).json({ message: 'Student is not withdrawn' }); return; }

  await db.update(students).set({ withdrawnAt: null, withdrawReason: null }).where(eq(students.id, id));
  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(reshape(row));
}

// ── Update onboarding progress ────────────────────────────────────────────────

const onboardingSchema = z.object({
  progress: z.array(z.object({ task: z.string(), done: z.boolean() })),
});

export async function updateOnboardingProgress(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  await db.update(students).set({ onboardingProgress: parsed.data.progress as any }).where(eq(students.id, id));
  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(reshape(row));
}
