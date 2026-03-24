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
  startDate: students.startDate,
  notes: students.notes,
  onboardingProgress: students.onboardingProgress,
  onboardingCompleted: students.onboardingCompleted,
  withdrawnAt: students.withdrawnAt,
  withdrawReason: students.withdrawReason,
  createdAt: students.createdAt,
  leadChildName: leads.childName,
  leadChildDob: leads.childDob,
  leadParentPhone: leads.parentPhone,
  leadSubmittedAt: leads.submittedAt,
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

function computeStatus(row: any): 'enrolled' | 'active' | 'graduated' | 'withdrawn' {
  if (row.withdrawnAt) return 'withdrawn';
  // Not yet started — startDate is null or in the future
  if (row.startDate) {
    const start = new Date(row.startDate);
    if (start > new Date()) return 'enrolled';
  } else {
    return 'enrolled';
  }
  // Graduated — child turns 7 based on birth year (currentYear - birthYear >= 7)
  if (row.leadChildDob) {
    const currentYear = new Date().getFullYear();
    const birthYear = new Date(row.leadChildDob).getFullYear();
    if (currentYear - birthYear >= 7) return 'graduated';
  }
  return 'active';
}

function reshape(row: typeof studentSelect extends Record<string, any> ? any : never) {
  return {
    id: row.id,
    leadId: row.leadId,
    enrolmentYear: row.enrolmentYear,
    enrolmentMonth: row.enrolmentMonth,
    packageId: row.packageId,
    enrolledAt: row.enrolledAt,
    startDate: row.startDate ?? null,
    notes: row.notes,
    onboardingProgress: row.onboardingProgress,
    onboardingCompleted: row.onboardingCompleted,
    withdrawnAt: row.withdrawnAt,
    withdrawReason: row.withdrawReason,
    createdAt: row.createdAt,
    status: computeStatus(row),
    lead: {
      childName: row.leadChildName,
      childDob: row.leadChildDob,
      parentPhone: row.leadParentPhone,
      submittedAt: row.leadSubmittedAt,
    },
    package: {
      name: row.packageName,
      programme: row.packageProgramme,
      age: row.packageAge,
      year: row.packageYear,
    },
  };
}

// ── List students (with filtering, search, pagination) ───────────────────────

export async function getStudents(req: Request, res: Response): Promise<void> {
  const statusFilter = req.query.status as string | undefined;
  const onboardingFilter = (req.query.onboarding as string) || 'all';
  const search = (req.query.search as string || '').trim().toLowerCase();
  const yearFilter = req.query.year ? Number(req.query.year) : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const sortBy = (req.query.sortBy as string) || 'enrolledAt';
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
  const onboardingStatusFilter = req.query.onboardingStatus as string | undefined; // notStarted, inProgress, readyToComplete

  // Fetch all rows (with optional SQL-level year filter)
  let query = queryStudents();
  if (yearFilter) query = query.where(eq(students.enrolmentYear, yearFilter)) as any;
  const rows = await query.orderBy(desc(students.enrolledAt));
  const all = rows.map(reshape);

  // Compute counts across ALL students (for status tabs)
  const statusCounts = { enrolled: 0, active: 0, graduated: 0, withdrawn: 0 };
  for (const s of all) statusCounts[s.status]++;

  // Apply filters
  let filtered = all;
  if (statusFilter) filtered = filtered.filter(s => s.status === statusFilter);
  if (onboardingFilter === 'pending') filtered = filtered.filter(s => !s.onboardingCompleted && s.status !== 'withdrawn');
  else if (onboardingFilter === 'completed') filtered = filtered.filter(s => s.onboardingCompleted);
  if (search) filtered = filtered.filter(s => s.lead.childName.toLowerCase().includes(search));

  // Compute onboarding counts (over filtered set, before pagination)
  const onboardingCounts = { total: filtered.length, notStarted: 0, inProgress: 0, readyToComplete: 0 };
  for (const s of filtered) {
    const tasks: { done: boolean }[] = Array.isArray(s.onboardingProgress) ? s.onboardingProgress : [];
    const total = tasks.length;
    const done = tasks.filter(t => t.done).length;
    if (total === 0 || done === 0) onboardingCounts.notStarted++;
    else if (done === total) onboardingCounts.readyToComplete++;
    else onboardingCounts.inProgress++;
  }

  // Filter by onboarding status (after counts so counts reflect all)
  if (onboardingStatusFilter) {
    filtered = filtered.filter(s => {
      const tasks: { done: boolean }[] = Array.isArray(s.onboardingProgress) ? s.onboardingProgress : [];
      const total = tasks.length;
      const done = tasks.filter((t: { done: boolean }) => t.done).length;
      if (onboardingStatusFilter === 'notStarted') return total === 0 || done === 0;
      if (onboardingStatusFilter === 'inProgress') return total > 0 && done > 0 && done < total;
      if (onboardingStatusFilter === 'readyToComplete') return total > 0 && done === total;
      return true;
    });
  }

  // Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'childName') cmp = a.lead.childName.localeCompare(b.lead.childName);
    else if (sortBy === 'startDate') {
      const aD = a.startDate ? new Date(a.startDate).getTime() : Infinity;
      const bD = b.startDate ? new Date(b.startDate).getTime() : Infinity;
      cmp = aD - bD;
    } else {
      cmp = new Date(a.enrolledAt).getTime() - new Date(b.enrolledAt).getTime();
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  // Paginate
  const total = filtered.length;
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Collect available years (from all pending students)
  const availableYears = [...new Set(all.filter(s => !s.onboardingCompleted && s.status !== 'withdrawn').map(s => s.enrolmentYear))].sort((a, b) => b - a);

  res.json({ items, total, page, pageSize, statusCounts, onboardingCounts, availableYears });
}

// ── Create student (enrol a lead) ─────────────────────────────────────────────

const createSchema = z.object({
  leadId: z.string().min(1),
  enrolmentYear: z.number().int().min(2000).max(2100),
  enrolmentMonth: z.number().int().min(1).max(12),
  packageId: z.string().min(1),
  enrolledAt: z.string().datetime().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes: z.string().optional(),
});

export async function createStudent(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { leadId, enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes } = parsed.data;

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
      startDate: startDate ? new Date(startDate) : null,
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
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
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

  const { enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes, childDob, childName, parentPhone } = parsed.data;

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
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
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
  if (progress && progress.length > 0 && progress.some(t => !t.done)) {
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
