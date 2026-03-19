"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStudents = getStudents;
exports.createStudent = createStudent;
exports.updateStudent = updateStudent;
exports.completeOnboarding = completeOnboarding;
exports.resetAllStudents = resetAllStudents;
exports.deleteStudent = deleteStudent;
exports.withdrawStudent = withdrawStudent;
exports.reactivateStudent = reactivateStudent;
exports.updateOnboardingProgress = updateOnboardingProgress;
const crypto_1 = require("crypto");
const zod_1 = require("zod");
const drizzle_orm_1 = require("drizzle-orm");
const client_js_1 = require("../db/client.js");
const schema_js_1 = require("../db/schema.js");
// ── Shared select + reshape ───────────────────────────────────────────────────
const studentSelect = {
    id: schema_js_1.students.id,
    leadId: schema_js_1.students.leadId,
    enrolmentYear: schema_js_1.students.enrolmentYear,
    enrolmentMonth: schema_js_1.students.enrolmentMonth,
    packageId: schema_js_1.students.packageId,
    enrolledAt: schema_js_1.students.enrolledAt,
    startDate: schema_js_1.students.startDate,
    notes: schema_js_1.students.notes,
    onboardingProgress: schema_js_1.students.onboardingProgress,
    onboardingCompleted: schema_js_1.students.onboardingCompleted,
    withdrawnAt: schema_js_1.students.withdrawnAt,
    withdrawReason: schema_js_1.students.withdrawReason,
    createdAt: schema_js_1.students.createdAt,
    leadChildName: schema_js_1.leads.childName,
    leadChildDob: schema_js_1.leads.childDob,
    leadParentPhone: schema_js_1.leads.parentPhone,
    leadSubmittedAt: schema_js_1.leads.submittedAt,
    packageName: schema_js_1.packages.name,
    packageProgramme: schema_js_1.packages.programme,
    packageAge: schema_js_1.packages.age,
    packageYear: schema_js_1.packages.year,
};
function queryStudents() {
    return client_js_1.db
        .select(studentSelect)
        .from(schema_js_1.students)
        .leftJoin(schema_js_1.leads, (0, drizzle_orm_1.eq)(schema_js_1.students.leadId, schema_js_1.leads.id))
        .leftJoin(schema_js_1.packages, (0, drizzle_orm_1.eq)(schema_js_1.students.packageId, schema_js_1.packages.id));
}
function computeStatus(row) {
    if (row.withdrawnAt)
        return 'withdrawn';
    // Not yet started — startDate is null or in the future
    if (row.startDate) {
        const start = new Date(row.startDate);
        if (start > new Date())
            return 'enrolled';
    }
    else {
        return 'enrolled';
    }
    // Graduated — child age > 6
    if (row.leadChildDob) {
        const now = new Date();
        const dob = new Date(row.leadChildDob);
        let age = now.getFullYear() - dob.getFullYear();
        if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate()))
            age--;
        if (age > 6)
            return 'graduated';
    }
    return 'active';
}
function reshape(row) {
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
async function getStudents(req, res) {
    const statusFilter = req.query.status;
    const onboardingFilter = req.query.onboarding || 'all';
    const search = (req.query.search || '').trim().toLowerCase();
    const yearFilter = req.query.year ? Number(req.query.year) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const sortBy = req.query.sortBy || 'enrolledAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const onboardingStatusFilter = req.query.onboardingStatus; // notStarted, inProgress, readyToComplete
    // Fetch all rows (with optional SQL-level year filter)
    let query = queryStudents();
    if (yearFilter)
        query = query.where((0, drizzle_orm_1.eq)(schema_js_1.students.enrolmentYear, yearFilter));
    const rows = await query.orderBy((0, drizzle_orm_1.desc)(schema_js_1.students.enrolledAt));
    const all = rows.map(reshape);
    // Compute counts across ALL students (for status tabs)
    const statusCounts = { enrolled: 0, active: 0, graduated: 0, withdrawn: 0 };
    for (const s of all)
        statusCounts[s.status]++;
    // Apply filters
    let filtered = all;
    if (statusFilter)
        filtered = filtered.filter(s => s.status === statusFilter);
    if (onboardingFilter === 'pending')
        filtered = filtered.filter(s => !s.onboardingCompleted && s.status !== 'withdrawn');
    else if (onboardingFilter === 'completed')
        filtered = filtered.filter(s => s.onboardingCompleted);
    if (search)
        filtered = filtered.filter(s => s.lead.childName.toLowerCase().includes(search));
    // Compute onboarding counts (over filtered set, before pagination)
    const onboardingCounts = { total: filtered.length, notStarted: 0, inProgress: 0, readyToComplete: 0 };
    for (const s of filtered) {
        const tasks = Array.isArray(s.onboardingProgress) ? s.onboardingProgress : [];
        const total = tasks.length;
        const done = tasks.filter(t => t.done).length;
        if (total === 0 || done === 0)
            onboardingCounts.notStarted++;
        else if (done === total)
            onboardingCounts.readyToComplete++;
        else
            onboardingCounts.inProgress++;
    }
    // Filter by onboarding status (after counts so counts reflect all)
    if (onboardingStatusFilter) {
        filtered = filtered.filter(s => {
            const tasks = Array.isArray(s.onboardingProgress) ? s.onboardingProgress : [];
            const total = tasks.length;
            const done = tasks.filter((t) => t.done).length;
            if (onboardingStatusFilter === 'notStarted')
                return total === 0 || done === 0;
            if (onboardingStatusFilter === 'inProgress')
                return total > 0 && done > 0 && done < total;
            if (onboardingStatusFilter === 'readyToComplete')
                return total > 0 && done === total;
            return true;
        });
    }
    // Sort
    filtered.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'childName')
            cmp = a.lead.childName.localeCompare(b.lead.childName);
        else if (sortBy === 'startDate') {
            const aD = a.startDate ? new Date(a.startDate).getTime() : Infinity;
            const bD = b.startDate ? new Date(b.startDate).getTime() : Infinity;
            cmp = aD - bD;
        }
        else {
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
const createSchema = zod_1.z.object({
    leadId: zod_1.z.string().min(1),
    enrolmentYear: zod_1.z.number().int().min(2000).max(2100),
    enrolmentMonth: zod_1.z.number().int().min(1).max(12),
    packageId: zod_1.z.string().min(1),
    enrolledAt: zod_1.z.string().datetime().optional(),
    startDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    notes: zod_1.z.string().optional(),
});
async function createStudent(req, res) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { leadId, enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes } = parsed.data;
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, leadId)).limit(1);
    if (!lead) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    const [pkg] = await client_js_1.db.select().from(schema_js_1.packages).where((0, drizzle_orm_1.eq)(schema_js_1.packages.id, packageId)).limit(1);
    if (!pkg) {
        res.status(404).json({ message: 'Package not found' });
        return;
    }
    const [existingStudent] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.leadId, leadId)).limit(1);
    if (existingStudent) {
        res.status(409).json({ message: 'Student already exists for this lead' });
        return;
    }
    const [settingRow] = await client_js_1.db.select().from(schema_js_1.systemSettings).where((0, drizzle_orm_1.eq)(schema_js_1.systemSettings.key, 'onboarding_tasks')).limit(1);
    const tasks = Array.isArray(settingRow?.value) ? settingRow.value : [];
    const onboardingProgress = tasks.map((task) => ({ task, done: false }));
    const now = new Date();
    const newId = (0, crypto_1.randomUUID)();
    await client_js_1.db.transaction(async (tx) => {
        await tx.insert(schema_js_1.students).values({
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
        await tx.update(schema_js_1.leads).set({ status: 'ENROLLED' }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, leadId));
    });
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, newId));
    res.status(201).json(reshape(row));
}
// ── Update student ────────────────────────────────────────────────────────────
const updateSchema = zod_1.z.object({
    enrolmentYear: zod_1.z.number().int().min(2000).max(2100).optional(),
    enrolmentMonth: zod_1.z.number().int().min(1).max(12).optional(),
    packageId: zod_1.z.string().min(1).optional(),
    enrolledAt: zod_1.z.string().datetime().optional(),
    startDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
    notes: zod_1.z.string().nullable().optional(),
    childDob: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    childName: zod_1.z.string().min(1).optional(),
    parentPhone: zod_1.z.string().min(1).optional(),
});
async function updateStudent(req, res) {
    const { id } = req.params;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const { enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate, notes, childDob, childName, parentPhone } = parsed.data;
    const leadUpdate = {};
    if (childDob !== undefined)
        leadUpdate.childDob = new Date(childDob);
    if (childName !== undefined)
        leadUpdate.childName = childName;
    if (parentPhone !== undefined)
        leadUpdate.parentPhone = parentPhone;
    await client_js_1.db.transaction(async (tx) => {
        await tx.update(schema_js_1.students).set({
            ...(enrolmentYear !== undefined ? { enrolmentYear } : {}),
            ...(enrolmentMonth !== undefined ? { enrolmentMonth } : {}),
            ...(packageId !== undefined ? { packageId } : {}),
            ...(enrolledAt !== undefined ? { enrolledAt: new Date(enrolledAt) } : {}),
            ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
            ...(notes !== undefined ? { notes } : {}),
        }).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
        if (Object.keys(leadUpdate).length > 0) {
            await tx.update(schema_js_1.leads).set(leadUpdate).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, existing.leadId));
        }
    });
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    res.json(reshape(row));
}
// ── Complete onboarding ───────────────────────────────────────────────────────
async function completeOnboarding(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const progress = existing.onboardingProgress;
    if (!progress || progress.length === 0 || progress.some(t => !t.done)) {
        res.status(400).json({ message: 'All onboarding tasks must be completed first' });
        return;
    }
    await client_js_1.db.update(schema_js_1.students).set({ onboardingCompleted: true }).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    res.json(reshape(row));
}
// ── Delete student ────────────────────────────────────────────────────────────
async function resetAllStudents(_req, res) {
    await client_js_1.db.delete(schema_js_1.students);
    res.json({ message: 'All students deleted' });
}
async function deleteStudent(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    await client_js_1.db.transaction(async (tx) => {
        await tx.delete(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
        await tx.update(schema_js_1.leads).set({ status: 'LOST' }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, existing.leadId));
    });
    res.status(204).end();
}
// ── Withdraw student ──────────────────────────────────────────────────────────
const withdrawSchema = zod_1.z.object({
    withdrawnAt: zod_1.z.string().datetime().optional(),
    withdrawReason: zod_1.z.string().optional(),
});
async function withdrawStudent(req, res) {
    const { id } = req.params;
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    const { withdrawnAt, withdrawReason } = parsed.data;
    await client_js_1.db.update(schema_js_1.students).set({
        withdrawnAt: withdrawnAt ? new Date(withdrawnAt) : new Date(),
        withdrawReason: withdrawReason ?? null,
    }).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    res.json(reshape(row));
}
// ── Reactivate student (undo withdrawal) ──────────────────────────────────────
async function reactivateStudent(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    if (!existing.withdrawnAt) {
        res.status(400).json({ message: 'Student is not withdrawn' });
        return;
    }
    await client_js_1.db.update(schema_js_1.students).set({ withdrawnAt: null, withdrawReason: null }).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    res.json(reshape(row));
}
// ── Update onboarding progress ────────────────────────────────────────────────
const onboardingSchema = zod_1.z.object({
    progress: zod_1.z.array(zod_1.z.object({ task: zod_1.z.string(), done: zod_1.z.boolean() })),
});
async function updateOnboardingProgress(req, res) {
    const { id } = req.params;
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const [existing] = await client_js_1.db.select().from(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Student not found' });
        return;
    }
    await client_js_1.db.update(schema_js_1.students).set({ onboardingProgress: parsed.data.progress }).where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    const [row] = await queryStudents().where((0, drizzle_orm_1.eq)(schema_js_1.students.id, id));
    res.json(reshape(row));
}
//# sourceMappingURL=students.controller.js.map