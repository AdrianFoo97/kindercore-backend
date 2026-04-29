import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, packages, students, studentEnrollments, systemSettings } from '../db/schema.js';

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
  monthlyFee: students.monthlyFee,
  feeOverridden: students.feeOverridden,
  ageOffset: students.ageOffset,
  studentChildName: students.childName,
  studentChildDob: students.childDob,
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
  packagePrice: packages.price,
};

function queryStudents() {
  return db
    .select(studentSelect)
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id))
    .leftJoin(packages, eq(students.packageId, packages.id));
}

// Effective child name/DOB: prefer student row, fall back to lead row.
function effectiveChildName(row: any): string | null {
  return row.studentChildName ?? row.leadChildName ?? null;
}
function effectiveChildDob(row: any): Date | null {
  return row.studentChildDob ?? row.leadChildDob ?? null;
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
  const dob = effectiveChildDob(row);
  if (dob) {
    const currentYear = new Date().getFullYear();
    const birthYear = new Date(dob).getFullYear();
    if (currentYear - birthYear >= 7) return 'graduated';
  }
  return 'active';
}

interface SiblingRef { id: string; childName: string }

function reshape(row: typeof studentSelect extends Record<string, any> ? any : never, siblings: SiblingRef[] = []) {
  return {
    id: row.id,
    leadId: row.leadId,
    enrolmentYear: row.enrolmentYear,
    enrolmentMonth: row.enrolmentMonth,
    packageId: row.packageId,
    enrolledAt: row.enrolledAt,
    startDate: row.startDate ?? null,
    notes: row.notes,
    monthlyFee: row.monthlyFee,
    feeOverridden: row.feeOverridden,
    ageOffset: row.ageOffset,
    onboardingProgress: row.onboardingProgress,
    onboardingCompleted: row.onboardingCompleted,
    withdrawnAt: row.withdrawnAt,
    withdrawReason: row.withdrawReason,
    createdAt: row.createdAt,
    status: computeStatus(row),
    siblings,
    lead: {
      childName: effectiveChildName(row),
      childDob: effectiveChildDob(row),
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

// Build a leadId → siblings map for a given set of student rows.
// "Siblings" of a student = other students sharing the same leadId.
async function loadSiblingsMap(leadIds: string[]): Promise<Map<string, SiblingRef[]>> {
  const map = new Map<string, SiblingRef[]>();
  if (leadIds.length === 0) return map;
  const rows = await db
    .select({
      id: students.id,
      leadId: students.leadId,
      studentChildName: students.childName,
      leadChildName: leads.childName,
    })
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id));
  // Group by leadId
  const byLead = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of rows) {
    if (!leadIds.includes(r.leadId)) continue;
    const name = r.studentChildName ?? r.leadChildName ?? '';
    if (!byLead.has(r.leadId)) byLead.set(r.leadId, []);
    byLead.get(r.leadId)!.push({ id: r.id, name });
  }
  // For each lead, the "siblings" of any student in it = all other students in the same lead
  for (const [leadId, group] of byLead) {
    if (group.length <= 1) continue;
    map.set(leadId, group.map(g => ({ id: g.id, childName: g.name })));
  }
  return map;
}

// Convenience for single-student responses
async function reshapeOne(row: any) {
  const map = await loadSiblingsMap([row.leadId]);
  const allInLead = map.get(row.leadId) ?? [];
  const otherSiblings = allInLead.filter(s => s.id !== row.id);
  return reshape(row, otherSiblings);
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

  // Build sibling map across all leadIds in the current result set
  const leadIds = [...new Set(rows.map(r => r.leadId))];
  const siblingsMap = await loadSiblingsMap(leadIds);
  const all = rows.map(r => {
    const groupSiblings = siblingsMap.get(r.leadId) ?? [];
    const others = groupSiblings.filter(s => s.id !== r.id);
    return reshape(r, others);
  });

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
  const rawTasks = settingRow?.value;
  const tasks: string[] = typeof rawTasks === 'string' ? JSON.parse(rawTasks) : (Array.isArray(rawTasks) ? rawTasks : []);
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
      monthlyFee: pkg.price ?? 0,
      feeOverridden: false,
      onboardingProgress,
      createdAt: now,
    });
    // Open the initial enrollment period. Same packageId/fee as the Student
    // row; startDate matches the student's startDate or enrolledAt fallback.
    await tx.insert(studentEnrollments).values({
      id: randomUUID(),
      studentId: newId,
      packageId,
      monthlyFee: pkg.price ?? 0,
      feeOverridden: false,
      startDate: startDate ? new Date(startDate) : (enrolledAt ? new Date(enrolledAt) : now),
      endDate: null,
      reason: null,
      createdAt: now,
    });
    // Enrollment implies a visit took place and the lead is qualified —
    // set every analytics column explicitly so the classifier agrees.
    await tx.update(leads).set({
      status: 'ENROLLED',
      attended: true,
      isQualified: true,
      visitOutcome: 'ATTENDED',
    }).where(eq(leads.id, leadId));
  });

  const [row] = await queryStudents().where(eq(students.id, newId));
  res.status(201).json(await reshapeOne(row));
}

// ── Create student WITH a new lead (manual / walk-in enrolment) ──────────────

const createWithLeadSchema = z.object({
  // Lead fields
  childName: z.string().min(1),
  parentPhone: z.string().min(1),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  howDidYouKnow: z.string().min(1),
  programme: z.string().min(1),
  submittedAt: z.string().datetime().optional(),
  // Student fields
  enrolmentYear: z.number().int().min(2000).max(2100),
  enrolmentMonth: z.number().int().min(1).max(12),
  packageId: z.string().min(1),
  enrolledAt: z.string().datetime().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
  notes: z.string().nullable().optional(),
  monthlyFee: z.number().min(0).optional(),
  feeOverridden: z.boolean().optional(),
});

export async function createStudentWithLead(req: Request, res: Response): Promise<void> {
  const parsed = createWithLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const {
    childName, parentPhone, childDob, howDidYouKnow, programme, submittedAt,
    enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes,
    monthlyFee, feeOverridden,
  } = parsed.data;

  const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
  if (!pkg) { res.status(404).json({ message: 'Package not found' }); return; }

  const [settingRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'onboarding_tasks')).limit(1);
  const rawTasks = settingRow?.value;
  const tasks: string[] = typeof rawTasks === 'string' ? JSON.parse(rawTasks) : (Array.isArray(rawTasks) ? rawTasks : []);
  const onboardingProgress = tasks.map((task: string) => ({ task, done: false }));

  const now = new Date();
  const submittedAtDate = submittedAt ? new Date(submittedAt) : now;
  const newLeadId = randomUUID();
  const newStudentId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(leads).values({
      id: newLeadId,
      submittedAt: submittedAtDate,
      childName,
      parentPhone,
      childDob: new Date(childDob),
      enrolmentYear,
      status: 'ENROLLED',
      attended: true,
      isQualified: true,
      visitOutcome: 'ATTENDED',
      statusChangedAt: now,
      howDidYouKnow,
      programme,
    });
    const initialFee = feeOverridden ? (monthlyFee ?? pkg.price ?? 0) : (pkg.price ?? 0);
    await tx.insert(students).values({
      id: newStudentId,
      leadId: newLeadId,
      enrolmentYear,
      enrolmentMonth,
      packageId,
      enrolledAt: enrolledAt ? new Date(enrolledAt) : now,
      startDate: startDate ? new Date(startDate) : null,
      notes: notes ?? null,
      monthlyFee: initialFee,
      feeOverridden: feeOverridden ?? false,
      onboardingProgress,
      createdAt: now,
    });
    // Open the initial enrollment period to mirror the Student row.
    await tx.insert(studentEnrollments).values({
      id: randomUUID(),
      studentId: newStudentId,
      packageId,
      monthlyFee: initialFee,
      feeOverridden: feeOverridden ?? false,
      startDate: startDate ? new Date(startDate) : (enrolledAt ? new Date(enrolledAt) : now),
      endDate: null,
      reason: null,
      createdAt: now,
    });
  });

  const [row] = await queryStudents().where(eq(students.id, newStudentId));
  res.status(201).json(await reshapeOne(row));
}

// ── Create sibling student (attach to existing Lead) ────────────────────────

const createSiblingSchema = z.object({
  leadId: z.string().min(1),
  childName: z.string().min(1),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  enrolmentYear: z.number().int().min(2000).max(2100),
  enrolmentMonth: z.number().int().min(1).max(12),
  packageId: z.string().min(1),
  enrolledAt: z.string().datetime().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
  notes: z.string().nullable().optional(),
  monthlyFee: z.number().min(0).optional(),
  feeOverridden: z.boolean().optional(),
});

export async function createSibling(req: Request, res: Response): Promise<void> {
  const parsed = createSiblingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const {
    leadId, childName, childDob,
    enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes,
    monthlyFee, feeOverridden,
  } = parsed.data;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }

  const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
  if (!pkg) { res.status(404).json({ message: 'Package not found' }); return; }

  const [settingRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'onboarding_tasks')).limit(1);
  const rawTasks = settingRow?.value;
  const tasks: string[] = typeof rawTasks === 'string' ? JSON.parse(rawTasks) : (Array.isArray(rawTasks) ? rawTasks : []);
  const onboardingProgress = tasks.map((task: string) => ({ task, done: false }));

  const now = new Date();
  const newId = randomUUID();
  const initialFee = feeOverridden ? (monthlyFee ?? pkg.price ?? 0) : (pkg.price ?? 0);

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
      monthlyFee: initialFee,
      feeOverridden: feeOverridden ?? false,
      childName,
      childDob: new Date(childDob),
      onboardingProgress,
      createdAt: now,
    });
    // Open the initial enrollment period to mirror the Student row.
    await tx.insert(studentEnrollments).values({
      id: randomUUID(),
      studentId: newId,
      packageId,
      monthlyFee: initialFee,
      feeOverridden: feeOverridden ?? false,
      startDate: startDate ? new Date(startDate) : (enrolledAt ? new Date(enrolledAt) : now),
      endDate: null,
      reason: null,
      createdAt: now,
    });
  });

  const [row] = await queryStudents().where(eq(students.id, newId));
  res.status(201).json(await reshapeOne(row));
}

// ── Update student ────────────────────────────────────────────────────────────

const updateSchema = z.object({
  enrolmentYear: z.number().int().min(2000).max(2100).optional(),
  enrolmentMonth: z.number().int().min(1).max(12).optional(),
  packageId: z.string().min(1).optional(),
  enrolledAt: z.string().datetime().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
  notes: z.string().nullable().optional(),
  monthlyFee: z.number().min(0).optional(),
  feeOverridden: z.boolean().optional(),
  ageOffset: z.number().int().min(-10).max(10).optional(),
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

  const { enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes, monthlyFee, feeOverridden, ageOffset, childDob, childName, parentPhone } = parsed.data;

  // Decide where childName/childDob writes go: if this student shares a Lead
  // with siblings (or already has its own override), write to Student.
  // Otherwise (solo student), write to Lead so the Leads page reflects the rename.
  const siblingCount = (await db.select({ id: students.id }).from(students).where(eq(students.leadId, existing.leadId))).length;
  const isSibling = siblingCount > 1 || existing.childName !== null || existing.childDob !== null;

  const studentChildUpdate: Record<string, unknown> = {};
  const leadUpdate: Record<string, unknown> = {};

  if (parentPhone !== undefined) leadUpdate.parentPhone = parentPhone;

  if (isSibling) {
    if (childName !== undefined) studentChildUpdate.childName = childName;
    if (childDob !== undefined) studentChildUpdate.childDob = new Date(childDob);
  } else {
    if (childName !== undefined) leadUpdate.childName = childName;
    if (childDob !== undefined) leadUpdate.childDob = new Date(childDob);
  }

  await db.transaction(async (tx) => {
    await tx.update(students).set({
      ...(enrolmentYear !== undefined ? { enrolmentYear } : {}),
      ...(enrolmentMonth !== undefined ? { enrolmentMonth } : {}),
      ...(packageId !== undefined ? { packageId } : {}),
      ...(enrolledAt !== undefined ? { enrolledAt: new Date(enrolledAt) } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(monthlyFee !== undefined ? { monthlyFee } : {}),
      ...(feeOverridden !== undefined ? { feeOverridden } : {}),
      ...(ageOffset !== undefined ? { ageOffset } : {}),
      ...studentChildUpdate,
    }).where(eq(students.id, id));

    if (Object.keys(leadUpdate).length > 0) {
      await tx.update(leads).set(leadUpdate as any).where(eq(leads.id, existing.leadId));
    }

    // Keep the current open enrollment in sync with the Student row's
    // package/fee fields. Editing here is for *correcting* the current
    // period — for scheduling a real package change, the frontend uses
    // POST /students/:id/enrollments instead.
    const enrollmentPatch: Record<string, unknown> = {};
    if (packageId !== undefined)     enrollmentPatch.packageId = packageId;
    if (monthlyFee !== undefined)    enrollmentPatch.monthlyFee = monthlyFee;
    if (feeOverridden !== undefined) enrollmentPatch.feeOverridden = feeOverridden;
    if (Object.keys(enrollmentPatch).length > 0) {
      const [currentEnr] = await tx.select().from(studentEnrollments).where(and(
        eq(studentEnrollments.studentId, id),
        isNull(studentEnrollments.endDate),
      )).limit(1);
      if (currentEnr) {
        await tx.update(studentEnrollments).set(enrollmentPatch).where(eq(studentEnrollments.id, currentEnr.id));
      }
    }
  });

  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(await reshapeOne(row));
}

// ── Complete onboarding ───────────────────────────────────────────────────────

export async function completeOnboarding(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const force = req.query.force === 'true';

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }

  if (force) {
    // Populate tasks from template and mark all done
    const rawProgress = existing.onboardingProgress;
    let progress: Array<{ task: string; done: boolean }> = typeof rawProgress === 'string' ? JSON.parse(rawProgress) : (Array.isArray(rawProgress) ? rawProgress : []);
    if (progress.length === 0) {
      // No tasks — load from settings template
      const [settingRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'onboarding_tasks')).limit(1);
      const rawTasks = settingRow?.value;
      const tasks: string[] = typeof rawTasks === 'string' ? JSON.parse(rawTasks) : (Array.isArray(rawTasks) ? rawTasks : []);
      progress = tasks.map((task: string) => ({ task, done: true }));
    } else {
      // Has tasks — mark all as done
      progress = progress.map(t => ({ ...t, done: true }));
    }
    await db.update(students).set({ onboardingProgress: progress, onboardingCompleted: true }).where(eq(students.id, id));
  } else {
    const rawProgress = existing.onboardingProgress;
    const progress: Array<{ task: string; done: boolean }> | null = typeof rawProgress === 'string' ? JSON.parse(rawProgress) : (Array.isArray(rawProgress) ? rawProgress : null);
    if (progress && progress.length > 0 && progress.some(t => !t.done)) {
      res.status(400).json({ message: 'All onboarding tasks must be completed first' });
      return;
    }
    await db.update(students).set({ onboardingCompleted: true }).where(eq(students.id, id));
  }
  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(await reshapeOne(row));
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
    // Reverting an enrolled lead back to LOST. Keep isQualified true
    // (non-cold reason by default) and preserve the earlier ATTENDED
    // visitOutcome — they did visit, they just didn't stay.
    await tx.update(leads).set({
      status: 'LOST',
      isQualified: true,
      visitOutcome: 'ATTENDED',
    }).where(eq(leads.id, existing.leadId));
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
  const withdrawDate = withdrawnAt ? new Date(withdrawnAt) : new Date();

  await db.transaction(async (tx) => {
    await tx.update(students).set({
      withdrawnAt: withdrawDate,
      withdrawReason: withdrawReason ?? null,
    }).where(eq(students.id, id));

    // Close the current open enrollment so revenue stops counting after the
    // withdraw date. Past months keep their original package + fee.
    await tx.update(studentEnrollments)
      .set({ endDate: withdrawDate })
      .where(and(
        eq(studentEnrollments.studentId, id),
        isNull(studentEnrollments.endDate),
      ));
  });

  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(await reshapeOne(row));
}

// ── Reactivate student (undo withdrawal) ──────────────────────────────────────

export async function reactivateStudent(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [existing] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Student not found' }); return; }
  if (!existing.withdrawnAt) { res.status(400).json({ message: 'Student is not withdrawn' }); return; }

  await db.transaction(async (tx) => {
    await tx.update(students).set({ withdrawnAt: null, withdrawReason: null }).where(eq(students.id, id));

    // Reopen the most recent enrollment (the one closed at withdrawal time).
    // This treats reactivation as "undo withdraw" — continuous package, no
    // gap. If the user wants to model an actual gap with different terms,
    // they can create a new enrollment afterwards.
    const [last] = await tx.select().from(studentEnrollments)
      .where(eq(studentEnrollments.studentId, id))
      .orderBy(desc(studentEnrollments.startDate))
      .limit(1);
    if (last && last.endDate !== null) {
      await tx.update(studentEnrollments).set({ endDate: null }).where(eq(studentEnrollments.id, last.id));
    }
  });

  const [row] = await queryStudents().where(eq(students.id, id));
  res.json(await reshapeOne(row));
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
  res.json(await reshapeOne(row));
}

// ── Revenue Analytics ────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function getRevenueAnalytics(req: Request, res: Response): Promise<void> {
  const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
  const prevYear = selectedYear - 1;
  const now = new Date();
  const isCurrentYear = selectedYear === now.getFullYear();
  const currentMonthIdx = isCurrentYear ? now.getMonth() : 11;

  // Enrollment-period source of truth. Each row carries its own package + fee;
  // for any given month the credited row is the one active at end-of-month
  // (cutoff). Mid-month withdrawals/changes still credit the period that was
  // open through the cutoff. Current month uses real `now` so same-day changes
  // take effect immediately.
  const enrollmentRows = await db
    .select({
      studentId: studentEnrollments.studentId,
      startDate: studentEnrollments.startDate,
      endDate: studentEnrollments.endDate,
      monthlyFee: studentEnrollments.monthlyFee,
      feeOverridden: studentEnrollments.feeOverridden,
      packageAge: packages.age,
      packageProgramme: packages.programme,
      packagePrice: packages.price,
      packageName: packages.name,
      reason: studentEnrollments.reason,
      studentChildName: students.childName,
      studentChildDob: students.childDob,
      leadChildName: leads.childName,
      leadChildDob: leads.childDob,
    })
    .from(studentEnrollments)
    .leftJoin(packages, eq(studentEnrollments.packageId, packages.id))
    .leftJoin(students, eq(studentEnrollments.studentId, students.id))
    .leftJoin(leads, eq(students.leadId, leads.id));

  type ERow = (typeof enrollmentRows)[number];

  const byStudent = new Map<string, ERow[]>();
  for (const r of enrollmentRows) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId)!.push(r);
  }

  type MonthAggregate = {
    month: string;
    revenue: number;
    studentCount: number;
    isForecast: boolean;
    breakdown: Record<number, Record<string, { count: number; revenue: number }>>;
  };

  function walkYear(year: number): MonthAggregate[] {
    const isCurY = year === now.getFullYear();
    return MONTHS.map((month, i) => {
      const isForecast = isCurY && i > now.getMonth();
      const isCurrentMonth = isCurY && i === now.getMonth();
      const monthStart = new Date(year, i, 1);
      const cutoff = isCurrentMonth ? now : new Date(year, i + 1, 0, 23, 59, 59);

      const overlaps = (e: ERow): boolean => {
        if (e.startDate > cutoff) return false;
        if (e.endDate) {
          if (isCurrentMonth ? e.endDate <= now : e.endDate < monthStart) return false;
        }
        return true;
      };
      const activeAtCutoff = (e: ERow): boolean => {
        if (e.startDate > cutoff) return false;
        if (e.endDate && e.endDate <= cutoff) return false;
        return true;
      };

      let revenue = 0, studentCount = 0;
      const breakdown: Record<number, Record<string, { count: number; revenue: number }>> = {};

      for (const enrollments of byStudent.values()) {
        const overlapping = enrollments.filter(overlaps);
        if (overlapping.length === 0) continue;
        const credit = overlapping.find(activeAtCutoff) ?? overlapping[overlapping.length - 1];
        // Graduated at 7 — student is excluded for the year they turn 7.
        const dob = credit.studentChildDob ?? credit.leadChildDob;
        if (dob) {
          const birthYear = dob.getFullYear();
          if (year - birthYear >= 7) continue;
        }
        const fee = credit.feeOverridden ? credit.monthlyFee : (credit.packagePrice ?? 0);
        revenue += fee;
        studentCount++;
        const age = credit.packageAge ?? 0;
        const programme = credit.packageProgramme || 'Unknown';
        if (!breakdown[age]) breakdown[age] = {};
        if (!breakdown[age][programme]) breakdown[age][programme] = { count: 0, revenue: 0 };
        breakdown[age][programme].count++;
        breakdown[age][programme].revenue += fee;
      }

      return { month, revenue, studentCount, isForecast, breakdown };
    });
  }

  const currentYearMonths = walkYear(selectedYear);
  const prevYearMonths = walkYear(prevYear);

  // Per-month enrollment events (new joins + package changes) for the
  // selected year. Driven entirely by enrollment-period start dates so
  // future-dated changes naturally appear in the month they take effect.
  type EnrollmentEvent = {
    studentId: string;
    studentName: string;
    effectiveDate: Date;
    type: 'new' | 'change';
    packageName: string | null;
    programme: string | null;
    packageAge: number | null;
    monthlyFee: number;
    prevPackageName: string | null;
    prevProgramme: string | null;
    prevMonthlyFee: number | null;
  };
  const SYSTEM_EVENT_REASONS = new Set(['Year rollover', 'Repair: stuck rollover']);
  const eventsByMonth: Record<number, EnrollmentEvent[]> = {};
  for (const enrollments of byStudent.values()) {
    const sorted = [...enrollments].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (e.startDate.getFullYear() !== selectedYear) continue;
      // Filter out automated rollover/repair events — they aren't meaningful
      // package decisions, just bookkeeping at the year boundary.
      if (e.reason && SYSTEM_EVENT_REASONS.has(e.reason)) continue;
      const monthIdx = e.startDate.getMonth();
      const prev = i > 0 ? sorted[i - 1] : null;
      const fee = e.feeOverridden ? e.monthlyFee : (e.packagePrice ?? 0);
      const prevFee = prev ? (prev.feeOverridden ? prev.monthlyFee : (prev.packagePrice ?? 0)) : null;
      const event: EnrollmentEvent = {
        studentId: e.studentId,
        studentName: e.studentChildName ?? e.leadChildName ?? '(unknown)',
        effectiveDate: e.startDate,
        type: prev ? 'change' : 'new',
        packageName: e.packageName,
        programme: e.packageProgramme,
        packageAge: e.packageAge,
        monthlyFee: fee,
        prevPackageName: prev?.packageName ?? null,
        prevProgramme: prev?.packageProgramme ?? null,
        prevMonthlyFee: prevFee,
      };
      if (!eventsByMonth[monthIdx]) eventsByMonth[monthIdx] = [];
      eventsByMonth[monthIdx].push(event);
    }
  }
  for (const list of Object.values(eventsByMonth)) {
    list.sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());
  }

  const monthlyRevenue = currentYearMonths.map((m, i) => ({
    month: m.month,
    revenue: m.revenue,
    studentCount: m.studentCount,
    current: m.revenue,
    previous: prevYearMonths[i].revenue,
    isForecast: m.isForecast,
    breakdown: m.breakdown,
    events: eventsByMonth[i] ?? [],
  }));

  const totalMonthlyRevenue = monthlyRevenue[currentMonthIdx]?.revenue ?? 0;
  const totalActiveStudents = monthlyRevenue[currentMonthIdx]?.studentCount ?? 0;
  const avgRevenuePerStudent = totalActiveStudents > 0 ? Math.round(totalMonthlyRevenue / totalActiveStudents) : 0;

  const actualRevenue = monthlyRevenue.filter(m => !m.isForecast).reduce((sum, m) => sum + m.revenue, 0);
  const forecastRevenue = monthlyRevenue.filter(m => m.isForecast).reduce((sum, m) => sum + m.revenue, 0);

  // Snapshot charts use the current month's enrollment-credited breakdown.
  const currentBreakdown = monthlyRevenue[currentMonthIdx]?.breakdown ?? {};
  const progMap = new Map<string, { revenue: number; studentCount: number }>();
  const ageMap = new Map<number, { revenue: number; studentCount: number }>();
  for (const ageStr of Object.keys(currentBreakdown)) {
    const age = Number(ageStr);
    for (const [prog, { count, revenue }] of Object.entries(currentBreakdown[age])) {
      const p = progMap.get(prog) ?? { revenue: 0, studentCount: 0 };
      p.revenue += revenue; p.studentCount += count;
      progMap.set(prog, p);
      const a = ageMap.get(age) ?? { revenue: 0, studentCount: 0 };
      a.revenue += revenue; a.studentCount += count;
      ageMap.set(age, a);
    }
  }
  const revenueByProgramme = [...progMap.entries()].map(([programme, data]) => ({ programme, ...data }));
  const revenueByAge = [...ageMap.entries()].sort((a, b) => a[0] - b[0]).map(([age, data]) => ({ age: `Age ${age}`, ...data }));

  // Available years
  const yearRows = await db.selectDistinct({ year: students.enrolmentYear }).from(students).orderBy(desc(students.enrolmentYear));
  const availableYears = yearRows.map(r => r.year);
  const currentYear = now.getFullYear();
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);
  availableYears.sort((a, b) => b - a);

  res.json({
    selectedYear,
    prevYear,
    currentMonthIdx,
    totalActiveStudents,
    totalMonthlyRevenue,
    avgRevenuePerStudent,
    annualRevenue: actualRevenue + forecastRevenue,
    actualRevenue,
    forecastRevenue,
    monthlyRevenue,
    revenueByProgramme,
    revenueByAge,
    availableYears,
  });
}
