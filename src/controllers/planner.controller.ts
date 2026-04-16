import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { teachers, classrooms, subjects, plannerTasks, scheduleBlocks, savedTimetables } from '../db/schema.js';

// ══════════════════════════════════════════════════════════════════════════════
// TEACHERS
// ══════════════════════════════════════════════════════════════════════════════

export async function getTeachers(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(teachers).orderBy(teachers.name);
  res.json(rows);
}

const createTeacherSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1).max(7),
  phone: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  allowedSubjectIds: z.array(z.string()).optional(),
  allowedClassroomIds: z.array(z.string()).optional(),
  workStartMinute: z.number().int().min(0).max(1440).optional(),
  workEndMinute: z.number().int().min(0).max(1440).optional(),
  workDays: z.array(z.number().int().min(0).max(4)).optional(),
  positionId: z.string().max(10).nullable().optional(),
  level: z.number().int().min(0).max(10).nullable().optional(),
  isFixedSalary: z.boolean().optional(),
  fixedSalaryAmount: z.number().min(0).nullable().optional(),
  salaryType: z.enum(['formula', 'fixed', 'hourly']).optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
  excludeFromProfitShare: z.boolean().optional(),
});

export async function createTeacher(req: Request, res: Response): Promise<void> {
  const parsed = createTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(teachers).values({
    id, name: parsed.data.name, color: parsed.data.color,
    phone: parsed.data.phone ?? null,
    employmentType: parsed.data.employmentType ?? 'full-time',
    allowedSubjectIds: parsed.data.allowedSubjectIds || null,
    allowedClassroomIds: parsed.data.allowedClassroomIds || null,
    workStartMinute: parsed.data.workStartMinute ?? null,
    workEndMinute: parsed.data.workEndMinute ?? null,
    workDays: parsed.data.workDays || null,
    positionId: parsed.data.positionId ?? null,
    level: parsed.data.level ?? 0,
    isFixedSalary: parsed.data.isFixedSalary ?? false,
    fixedSalaryAmount: parsed.data.fixedSalaryAmount ?? null,
    salaryType: parsed.data.salaryType ?? 'formula',
    hourlyRate: parsed.data.hourlyRate ?? null,
    excludeFromProfitShare: parsed.data.excludeFromProfitShare ?? false,
    createdAt: now, updatedAt: now,
  });
  const [created] = await db.select().from(teachers).where(eq(teachers.id, id));
  res.status(201).json(created);
}

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).max(7).optional(),
  phone: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  allowedSubjectIds: z.array(z.string()).nullable().optional(),
  allowedClassroomIds: z.array(z.string()).nullable().optional(),
  workStartMinute: z.number().int().min(0).max(1440).nullable().optional(),
  workEndMinute: z.number().int().min(0).max(1440).nullable().optional(),
  workDays: z.array(z.number().int().min(0).max(4)).nullable().optional(),
  positionId: z.string().max(10).nullable().optional(),
  level: z.number().int().min(0).max(10).nullable().optional(),
  isFixedSalary: z.boolean().optional(),
  fixedSalaryAmount: z.number().min(0).nullable().optional(),
  salaryType: z.enum(['formula', 'fixed', 'hourly']).optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
  excludeFromProfitShare: z.boolean().optional(),
  overrideProfitShareWeight: z.boolean().optional(),
  customProfitShareWeight: z.number().nullable().optional(),
  isActive: z.boolean().optional(),
  resignedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

export async function updateTeacher(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(teachers).where(eq(teachers.id, id));
  if (!existing) { res.status(404).json({ message: 'Teacher not found' }); return; }

  const { resignedAt, createdAt, ...rest } = parsed.data;
  const setData: any = { ...rest, updatedAt: new Date() };
  if (resignedAt !== undefined) setData.resignedAt = resignedAt ? new Date(resignedAt) : null;
  if (createdAt !== undefined && createdAt) setData.createdAt = new Date(createdAt);
  await db.update(teachers).set(setData).where(eq(teachers.id, id));
  const [updated] = await db.select().from(teachers).where(eq(teachers.id, id));
  res.json(updated);
}

export async function deleteTeacher(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(teachers).where(eq(teachers.id, id));
  if (!existing) { res.status(404).json({ message: 'Teacher not found' }); return; }

  await db.update(teachers).set({ isActive: false, updatedAt: new Date() }).where(eq(teachers.id, id));
  res.status(204).end();
}

// ══════════════════════════════════════════════════════════════════════════════
// CLASSROOMS
// ══════════════════════════════════════════════════════════════════════════════

export async function getClassrooms(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(classrooms).where(eq(classrooms.isActive, true)).orderBy(classrooms.name);
  res.json(rows);
}

const createClassroomSchema = z.object({
  name: z.string().min(1),
  capacity: z.number().int().positive().optional(),
  startMinute: z.number().int().min(0).max(1440).optional(),
  endMinute: z.number().int().min(0).max(1440).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(4)).optional(),
});

export async function createClassroom(req: Request, res: Response): Promise<void> {
  const parsed = createClassroomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(classrooms).values({
    id, name: parsed.data.name, capacity: parsed.data.capacity ?? null,
    startMinute: parsed.data.startMinute ?? null, endMinute: parsed.data.endMinute ?? null,
    daysOfWeek: parsed.data.daysOfWeek ?? null,
    createdAt: now, updatedAt: now,
  });
  const [created] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  res.status(201).json(created);
}

const updateClassroomSchema = z.object({
  name: z.string().min(1).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  startMinute: z.number().int().min(0).max(1440).nullable().optional(),
  endMinute: z.number().int().min(0).max(1440).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(4)).nullable().optional(),
});

export async function updateClassroom(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateClassroomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  if (!existing) { res.status(404).json({ message: 'Classroom not found' }); return; }

  await db.update(classrooms).set({ ...parsed.data, updatedAt: new Date() }).where(eq(classrooms.id, id));
  const [updated] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  res.json(updated);
}

export async function deleteClassroom(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  if (!existing) { res.status(404).json({ message: 'Classroom not found' }); return; }

  await db.update(classrooms).set({ isActive: false, updatedAt: new Date() }).where(eq(classrooms.id, id));
  res.status(204).end();
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBJECTS
// ══════════════════════════════════════════════════════════════════════════════

export async function getSubjects(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(subjects).orderBy(subjects.name);
  res.json(rows);
}

const createSubjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1).max(7),
  lessonsPerWeek: z.number().int().positive().optional(),
  defaultDuration: z.number().int().min(15).optional(),
  classLessons: z.record(z.number().int().min(0)).optional(),
});

export async function createSubject(req: Request, res: Response): Promise<void> {
  const parsed = createSubjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const id = randomUUID();
  await db.insert(subjects).values({ id, name: parsed.data.name, color: parsed.data.color, lessonsPerWeek: parsed.data.lessonsPerWeek ?? null, defaultDuration: parsed.data.defaultDuration ?? 60, classLessons: parsed.data.classLessons ?? null, createdAt: new Date() });
  const [created] = await db.select().from(subjects).where(eq(subjects.id, id));
  res.status(201).json(created);
}

const updateSubjectSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).max(7).optional(),
  lessonsPerWeek: z.number().int().positive().nullable().optional(),
  defaultDuration: z.number().int().min(15).nullable().optional(),
  classLessons: z.record(z.number().int().min(0)).nullable().optional(),
});

export async function updateSubject(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateSubjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(subjects).where(eq(subjects.id, id));
  if (!existing) { res.status(404).json({ message: 'Subject not found' }); return; }

  await db.update(subjects).set(parsed.data).where(eq(subjects.id, id));
  const [updated] = await db.select().from(subjects).where(eq(subjects.id, id));
  res.json(updated);
}

export async function deleteSubject(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(subjects).where(eq(subjects.id, id));
  if (!existing) { res.status(404).json({ message: 'Subject not found' }); return; }

  await db.delete(subjects).where(eq(subjects.id, id));
  res.status(204).end();
}

// ══════════════════════════════════════════════════════════════════════════════
// PLANNER TASKS
// ══════════════════════════════════════════════════════════════════════════════

export async function getTasks(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(plannerTasks).orderBy(plannerTasks.name);
  res.json(rows);
}

const createTaskSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['TEACHING', 'ADMIN', 'DUTY', 'BREAK', 'OTHER']),
  color: z.string().min(1).max(7),
  defaultDuration: z.number().int().min(1).optional().default(30),
});

export async function createTask(req: Request, res: Response): Promise<void> {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const id = randomUUID();
  await db.insert(plannerTasks).values({ id, name: parsed.data.name, category: parsed.data.category, color: parsed.data.color, defaultDuration: parsed.data.defaultDuration, createdAt: new Date() });
  const [created] = await db.select().from(plannerTasks).where(eq(plannerTasks.id, id));
  res.status(201).json(created);
}

const updateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(['TEACHING', 'ADMIN', 'DUTY', 'BREAK', 'OTHER']).optional(),
  color: z.string().min(1).max(7).optional(),
  defaultDuration: z.number().int().min(1).optional(),
});

export async function updateTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(plannerTasks).where(eq(plannerTasks.id, id));
  if (!existing) { res.status(404).json({ message: 'Task not found' }); return; }

  await db.update(plannerTasks).set(parsed.data).where(eq(plannerTasks.id, id));
  const [updated] = await db.select().from(plannerTasks).where(eq(plannerTasks.id, id));
  res.json(updated);
}

export async function deleteTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(plannerTasks).where(eq(plannerTasks.id, id));
  if (!existing) { res.status(404).json({ message: 'Task not found' }); return; }

  await db.delete(plannerTasks).where(eq(plannerTasks.id, id));
  res.status(204).end();
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE BLOCKS — helpers
// ══════════════════════════════════════════════════════════════════════════════

const blockSelect = {
  id: scheduleBlocks.id,
  weekDate: scheduleBlocks.weekDate,
  dayOfWeek: scheduleBlocks.dayOfWeek,
  startMinute: scheduleBlocks.startMinute,
  durationMinutes: scheduleBlocks.durationMinutes,
  teacherId: scheduleBlocks.teacherId,
  subjectId: scheduleBlocks.subjectId,
  taskId: scheduleBlocks.taskId,
  classroomId: scheduleBlocks.classroomId,
  assignedTeacherIds: scheduleBlocks.assignedTeacherIds,
  notes: scheduleBlocks.notes,
  createdAt: scheduleBlocks.createdAt,
  updatedAt: scheduleBlocks.updatedAt,
  teacherName: teachers.name,
  teacherColor: teachers.color,
  subjectName: subjects.name,
  subjectColor: subjects.color,
  taskName: plannerTasks.name,
  taskCategory: plannerTasks.category,
  taskColor: plannerTasks.color,
  classroomName: classrooms.name,
  classroomCapacity: classrooms.capacity,
};

function queryBlocks() {
  return db
    .select(blockSelect)
    .from(scheduleBlocks)
    .leftJoin(teachers, eq(scheduleBlocks.teacherId, teachers.id))
    .leftJoin(subjects, eq(scheduleBlocks.subjectId, subjects.id))
    .leftJoin(plannerTasks, eq(scheduleBlocks.taskId, plannerTasks.id))
    .leftJoin(classrooms, eq(scheduleBlocks.classroomId, classrooms.id));
}

function reshapeBlock(row: any) {
  return {
    id: row.id,
    weekDate: row.weekDate,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    teacherId: row.teacherId,
    subjectId: row.subjectId,
    taskId: row.taskId,
    classroomId: row.classroomId,
    assignedTeacherIds: row.assignedTeacherIds,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    teacher: row.teacherName ? { name: row.teacherName, color: row.teacherColor } : null,
    subject: row.subjectName ? { name: row.subjectName, color: row.subjectColor } : null,
    task: row.taskName ? { name: row.taskName, category: row.taskCategory, color: row.taskColor } : null,
    classroom: row.classroomName ? { name: row.classroomName, capacity: row.classroomCapacity } : null,
  };
}

/** Find conflicting blocks: same teacher OR same classroom at overlapping time. */
async function findConflicts(opts: {
  teacherId?: string | null;
  classroomId?: string | null;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  weekDate: Date;
  excludeBlockId?: string;
}) {
  const { teacherId, classroomId, dayOfWeek, startMinute, durationMinutes, weekDate, excludeBlockId } = opts;
  const newEnd = startMinute + durationMinutes;

  // Fetch all blocks for the same weekDate + dayOfWeek
  const rows = await db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.weekDate, weekDate), eq(scheduleBlocks.dayOfWeek, dayOfWeek)));

  const conflicts: typeof rows = [];
  for (const row of rows) {
    if (excludeBlockId && row.id === excludeBlockId) continue;
    const existingEnd = row.startMinute + row.durationMinutes;
    const overlaps = row.startMinute < newEnd && startMinute < existingEnd;
    if (!overlaps) continue;

    const sameTeacher = teacherId && row.teacherId && row.teacherId === teacherId;
    const sameClassroom = classroomId && row.classroomId && row.classroomId === classroomId;
    if (sameTeacher || sameClassroom) conflicts.push(row);
  }
  return conflicts;
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE BLOCKS — endpoints
// ══════════════════════════════════════════════════════════════════════════════

export async function getBlocks(req: Request, res: Response): Promise<void> {
  const weekDateStr = req.query.weekDate as string | undefined;
  if (!weekDateStr) {
    res.status(400).json({ message: 'weekDate query parameter is required' });
    return;
  }
  const weekDate = new Date(weekDateStr);
  const rows = await queryBlocks().where(eq(scheduleBlocks.weekDate, weekDate));
  res.json(rows.map(reshapeBlock));
}

const createBlockSchema = z.object({
  weekDate: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0),
  durationMinutes: z.number().int().min(1).default(30),
  teacherId: z.string().optional().nullable(),
  subjectId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  classroomId: z.string().optional().nullable(),
  assignedTeacherIds: z.array(z.string()).optional().nullable(),
  notes: z.string().optional().nullable(),
  skipConflictCheck: z.boolean().optional(),
});

export async function createBlock(req: Request, res: Response): Promise<void> {
  const parsed = createBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { weekDate: weekDateStr, dayOfWeek, startMinute, durationMinutes, teacherId, subjectId, taskId, classroomId, assignedTeacherIds, notes, skipConflictCheck } = parsed.data;
  const weekDate = new Date(weekDateStr);

  if (teacherId && !skipConflictCheck) {
    const conflicts = await findConflicts({ teacherId, classroomId, dayOfWeek, startMinute, durationMinutes, weekDate });
    if (conflicts.length > 0) {
      res.status(409).json({ message: 'Schedule conflict detected', conflicts });
      return;
    }
  }

  const now = new Date();
  const id = randomUUID();
  await db.insert(scheduleBlocks).values({
    id,
    weekDate,
    dayOfWeek,
    startMinute,
    durationMinutes,
    teacherId: teacherId ?? null,
    subjectId: subjectId ?? null,
    taskId: taskId ?? null,
    classroomId: classroomId ?? null,
    assignedTeacherIds: assignedTeacherIds ?? null,
    notes: notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await queryBlocks().where(eq(scheduleBlocks.id, id));
  res.status(201).json(reshapeBlock(row));
}

const updateBlockSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startMinute: z.number().int().min(0).optional(),
  durationMinutes: z.number().int().min(1).optional(),
  teacherId: z.string().nullable().optional(),
  subjectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  classroomId: z.string().nullable().optional(),
  assignedTeacherIds: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  skipConflictCheck: z.boolean().optional(),
});

export async function updateBlock(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, id));
  if (!existing) { res.status(404).json({ message: 'Block not found' }); return; }

  const merged = {
    dayOfWeek: parsed.data.dayOfWeek ?? existing.dayOfWeek,
    startMinute: parsed.data.startMinute ?? existing.startMinute,
    durationMinutes: parsed.data.durationMinutes ?? existing.durationMinutes,
    teacherId: parsed.data.teacherId ?? existing.teacherId,
    classroomId: parsed.data.classroomId !== undefined ? parsed.data.classroomId : existing.classroomId,
  };

  if (!parsed.data.skipConflictCheck) {
    const conflicts = await findConflicts({
      teacherId: merged.teacherId,
      classroomId: merged.classroomId,
      dayOfWeek: merged.dayOfWeek,
      startMinute: merged.startMinute,
      durationMinutes: merged.durationMinutes,
      weekDate: existing.weekDate,
      excludeBlockId: id,
    });
    if (conflicts.length > 0) {
      res.status(409).json({ message: 'Schedule conflict detected', conflicts });
      return;
    }
  }

  const { skipConflictCheck, ...updateData } = parsed.data;
  await db.update(scheduleBlocks).set({ ...updateData, updatedAt: new Date() }).where(eq(scheduleBlocks.id, id));
  const [row] = await queryBlocks().where(eq(scheduleBlocks.id, id));
  res.json(reshapeBlock(row));
}

export async function deleteBlock(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, id));
  if (!existing) { res.status(404).json({ message: 'Block not found' }); return; }

  await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, id));
  res.status(204).end();
}

const duplicateBlockSchema = z.object({
  blockId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startMinute: z.number().int().min(0).optional(),
});

export async function duplicateBlock(req: Request, res: Response): Promise<void> {
  const parsed = duplicateBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { blockId, dayOfWeek, startMinute } = parsed.data;

  const [source] = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, blockId));
  if (!source) { res.status(404).json({ message: 'Source block not found' }); return; }

  const newDayOfWeek = dayOfWeek ?? source.dayOfWeek;
  const newStartMinute = startMinute ?? source.startMinute;

  const conflicts = await findConflicts({
    teacherId: source.teacherId,
    classroomId: source.classroomId,
    dayOfWeek: newDayOfWeek,
    startMinute: newStartMinute,
    durationMinutes: source.durationMinutes,
    weekDate: source.weekDate,
  });
  if (conflicts.length > 0) {
    res.status(409).json({ message: 'Schedule conflict detected', conflicts });
    return;
  }

  const now = new Date();
  const id = randomUUID();
  await db.insert(scheduleBlocks).values({
    id,
    weekDate: source.weekDate,
    dayOfWeek: newDayOfWeek,
    startMinute: newStartMinute,
    durationMinutes: source.durationMinutes,
    teacherId: source.teacherId,
    subjectId: source.subjectId,
    taskId: source.taskId,
    classroomId: source.classroomId,
    notes: source.notes,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await queryBlocks().where(eq(scheduleBlocks.id, id));
  res.status(201).json(reshapeBlock(row));
}

const copyWeekSchema = z.object({
  sourceWeekDate: z.string().min(1),
  targetWeekDate: z.string().min(1),
});

export async function copyWeek(req: Request, res: Response): Promise<void> {
  const parsed = copyWeekSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const sourceWeekDate = new Date(parsed.data.sourceWeekDate);
  const targetWeekDate = new Date(parsed.data.targetWeekDate);

  const sourceBlocks = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.weekDate, sourceWeekDate));
  if (sourceBlocks.length === 0) {
    res.status(404).json({ message: 'No blocks found for source week' });
    return;
  }

  const now = new Date();
  const newBlocks = sourceBlocks.map((block) => ({
    id: randomUUID(),
    weekDate: targetWeekDate,
    dayOfWeek: block.dayOfWeek,
    startMinute: block.startMinute,
    durationMinutes: block.durationMinutes,
    teacherId: block.teacherId,
    subjectId: block.subjectId,
    taskId: block.taskId,
    classroomId: block.classroomId,
    notes: block.notes,
    createdAt: now,
    updatedAt: now,
  }));

  await db.insert(scheduleBlocks).values(newBlocks);

  const rows = await queryBlocks().where(eq(scheduleBlocks.weekDate, targetWeekDate));
  res.status(201).json(rows.map(reshapeBlock));
}

const checkConflictsSchema = z.object({
  teacherId: z.string().optional().nullable(),
  classroomId: z.string().optional().nullable(),
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0),
  durationMinutes: z.number().int().min(1),
  weekDate: z.string().min(1),
  excludeBlockId: z.string().optional(),
});

export async function checkConflicts(req: Request, res: Response): Promise<void> {
  const parsed = checkConflictsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { teacherId, classroomId, dayOfWeek, startMinute, durationMinutes, weekDate, excludeBlockId } = parsed.data;
  const conflicts = await findConflicts({
    teacherId,
    classroomId,
    dayOfWeek,
    startMinute,
    durationMinutes,
    weekDate: new Date(weekDate),
    excludeBlockId,
  });
  res.json(conflicts);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVED TIMETABLES
// ══════════════════════════════════════════════════════════════════════════════

export async function getSavedTimetables(_req: Request, res: Response): Promise<void> {
  const rows = await db.select({
    id: savedTimetables.id,
    name: savedTimetables.name,
    createdAt: savedTimetables.createdAt,
    updatedAt: savedTimetables.updatedAt,
  }).from(savedTimetables).orderBy(desc(savedTimetables.updatedAt));
  res.json(rows);
}

export async function saveTimetable(req: Request, res: Response): Promise<void> {
  const schema = z.object({ name: z.string().min(1).max(191), weekDate: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { name, weekDate } = parsed.data;
  // Fetch all blocks for this week
  const weekDateObj = new Date(weekDate);
  const blocks = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.weekDate, weekDateObj));
  // Strip ids, weekDate, timestamps — save only the block data
  const blockData = blocks.map(b => ({
    dayOfWeek: b.dayOfWeek,
    startMinute: b.startMinute,
    durationMinutes: b.durationMinutes,
    teacherId: b.teacherId,
    subjectId: b.subjectId,
    taskId: b.taskId,
    classroomId: b.classroomId,
    notes: b.notes,
  }));

  const now = new Date();
  const id = randomUUID();
  await db.insert(savedTimetables).values({
    id, name, blocks: blockData, createdAt: now, updatedAt: now,
  });
  res.status(201).json({ id, name, blockCount: blockData.length, createdAt: now });
}

export async function loadTimetable(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const weekDate = req.query.weekDate as string;
  if (!weekDate) {
    res.status(400).json({ message: 'weekDate query parameter required' });
    return;
  }
  const [saved] = await db.select().from(savedTimetables).where(eq(savedTimetables.id, id));
  if (!saved) {
    res.status(404).json({ message: 'Saved timetable not found' });
    return;
  }
  const weekDateObj = new Date(weekDate);
  // Delete existing blocks for this week
  await db.delete(scheduleBlocks).where(eq(scheduleBlocks.weekDate, weekDateObj));
  // Insert saved blocks
  const blockData = saved.blocks as Array<{
    dayOfWeek: number; startMinute: number; durationMinutes: number;
    teacherId: string | null; subjectId: string | null; taskId: string | null;
    classroomId: string | null; notes: string | null;
  }>;
  const now = new Date();
  if (blockData.length > 0) {
    await db.insert(scheduleBlocks).values(
      blockData.map(b => ({
        id: randomUUID(),
        weekDate: weekDateObj,
        dayOfWeek: b.dayOfWeek,
        startMinute: b.startMinute,
        durationMinutes: b.durationMinutes,
        teacherId: b.teacherId,
        subjectId: b.subjectId,
        taskId: b.taskId,
        classroomId: b.classroomId,
        notes: b.notes,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }
  res.json({ message: 'Timetable loaded', blockCount: blockData.length });
}

export async function deleteSavedTimetable(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await db.delete(savedTimetables).where(eq(savedTimetables.id, id));
  res.json({ message: 'Deleted' });
}
