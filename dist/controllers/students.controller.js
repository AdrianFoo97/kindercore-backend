import { z } from 'zod';
import { prisma } from '../db/client.js';
// ── List all students ─────────────────────────────────────────────────────────
export async function getStudents(_req, res) {
    const students = await prisma.student.findMany({
        include: {
            lead: { select: { childName: true, childDob: true, parentPhone: true } },
            package: { select: { name: true, programme: true, age: true, year: true } },
        },
        orderBy: { enrolledAt: 'desc' },
    });
    res.json(students);
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
export async function createStudent(req, res) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { leadId, enrolmentYear, enrolmentMonth, packageId, enrolledAt, notes } = parsed.data;
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
        res.status(404).json({ message: 'Package not found' });
        return;
    }
    const existing = await prisma.student.findUnique({ where: { leadId } });
    if (existing) {
        res.status(409).json({ message: 'Student already exists for this lead' });
        return;
    }
    // Snapshot current onboarding tasks for this student
    const settingRow = await prisma.systemSetting.findUnique({ where: { key: 'onboarding_tasks' } });
    const tasks = Array.isArray(settingRow?.value) ? settingRow.value : [];
    const onboardingProgress = tasks.map((task) => ({ task, done: false }));
    const [student] = await prisma.$transaction([
        prisma.student.create({
            data: {
                leadId,
                enrolmentYear,
                enrolmentMonth,
                packageId,
                ...(enrolledAt ? { enrolledAt: new Date(enrolledAt) } : {}),
                notes: notes ?? null,
                onboardingProgress,
            },
            include: {
                lead: { select: { childName: true, childDob: true, parentPhone: true } },
                package: { select: { name: true, programme: true, age: true, year: true } },
            },
        }),
        prisma.lead.update({ where: { id: leadId }, data: { status: 'ENROLLED' } }),
    ]);
    res.status(201).json(student);
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
export async function updateStudent(req, res) {
    const { id } = req.params;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const { enrolmentYear, enrolmentMonth, packageId, enrolledAt, notes, childDob, childName, parentPhone } = parsed.data;
    const leadUpdate = {};
    if (childDob !== undefined)
        leadUpdate.childDob = new Date(childDob);
    if (childName !== undefined)
        leadUpdate.childName = childName;
    if (parentPhone !== undefined)
        leadUpdate.parentPhone = parentPhone;
    const [student] = await prisma.$transaction([
        prisma.student.update({
            where: { id },
            data: {
                ...(enrolmentYear !== undefined ? { enrolmentYear } : {}),
                ...(enrolmentMonth !== undefined ? { enrolmentMonth } : {}),
                ...(packageId !== undefined ? { packageId } : {}),
                ...(enrolledAt !== undefined ? { enrolledAt: new Date(enrolledAt) } : {}),
                ...(notes !== undefined ? { notes } : {}),
            },
            include: {
                lead: { select: { childName: true, childDob: true, parentPhone: true } },
                package: { select: { name: true, programme: true, age: true, year: true } },
            },
        }),
        ...(Object.keys(leadUpdate).length > 0
            ? [prisma.lead.update({ where: { id: existing.leadId }, data: leadUpdate })]
            : []),
    ]);
    res.json(student);
}
// ── Complete onboarding ───────────────────────────────────────────────────────
export async function completeOnboarding(req, res) {
    const { id } = req.params;
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const progress = existing.onboardingProgress;
    if (!progress || progress.length === 0 || progress.some(t => !t.done)) {
        res.status(400).json({ message: 'All onboarding tasks must be completed first' });
        return;
    }
    const student = await prisma.student.update({
        where: { id },
        data: { onboardingCompleted: true },
        include: {
            lead: { select: { childName: true, childDob: true, parentPhone: true } },
            package: { select: { name: true, programme: true, age: true, year: true } },
        },
    });
    res.json(student);
}
// ── Delete student ────────────────────────────────────────────────────────────
export async function deleteStudent(req, res) {
    const { id } = req.params;
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    await prisma.$transaction([
        prisma.student.delete({ where: { id } }),
        prisma.lead.update({ where: { id: existing.leadId }, data: { status: 'LOST' } }),
    ]);
    res.status(204).end();
}
// ── Withdraw student ──────────────────────────────────────────────────────────
const withdrawSchema = z.object({
    withdrawnAt: z.string().datetime().optional(),
    withdrawReason: z.string().optional(),
});
export async function withdrawStudent(req, res) {
    const { id } = req.params;
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const { withdrawnAt, withdrawReason } = parsed.data;
    const student = await prisma.student.update({
        where: { id },
        data: {
            withdrawnAt: withdrawnAt ? new Date(withdrawnAt) : new Date(),
            withdrawReason: withdrawReason ?? null,
        },
        include: {
            lead: { select: { childName: true, childDob: true, parentPhone: true } },
            package: { select: { name: true, programme: true, age: true, year: true } },
        },
    });
    res.json(student);
}
// ── Reactivate student (undo withdrawal) ──────────────────────────────────────
export async function reactivateStudent(req, res) {
    const { id } = req.params;
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    if (!existing.withdrawnAt) {
        res.status(400).json({ message: 'Student is not withdrawn' });
        return;
    }
    const student = await prisma.student.update({
        where: { id },
        data: { withdrawnAt: null, withdrawReason: null },
        include: {
            lead: { select: { childName: true, childDob: true, parentPhone: true } },
            package: { select: { name: true, programme: true, age: true, year: true } },
        },
    });
    res.json(student);
}
// ── Update onboarding progress ────────────────────────────────────────────────
const onboardingSchema = z.object({
    progress: z.array(z.object({
        task: z.string(),
        done: z.boolean(),
    })),
});
export async function updateOnboardingProgress(req, res) {
    const { id } = req.params;
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const student = await prisma.student.update({
        where: { id },
        data: { onboardingProgress: parsed.data.progress },
        include: {
            lead: { select: { childName: true, childDob: true, parentPhone: true } },
            package: { select: { name: true, programme: true, age: true, year: true } },
        },
    });
    res.json(student);
}
//# sourceMappingURL=students.controller.js.map