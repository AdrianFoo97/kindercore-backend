import { randomUUID } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { classrooms, subjects, systemSettings } from '../db/schema.js';
import { BRANCHES_SETTING, planBranchCopy, withBranchIds, type Branch, type CopyPick, type CopySubject } from './branches.logic.js';

// Branches and what belongs to them: classes and subjects (Settings →
// Timetable, the Operations Planner). Tasks are shared by every branch.

export async function readBranches(): Promise<Branch[]> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, BRANCHES_SETTING));
  let v: unknown = row?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } }
  return Array.isArray(v) ? (v as Branch[]) : [];
}

async function saveBranches(list: Branch[]): Promise<void> {
  const now = new Date();
  await db.insert(systemSettings).values({ id: randomUUID(), key: BRANCHES_SETTING, value: list as never, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: list as never, updatedAt: now } });
}

/**
 * Startup: give every branch a lasting id, and put classes / subjects that
 * don't have a branch yet under the first branch. Idempotent.
 */
export async function ensureBranchIds(): Promise<{ named: number; classes: number; subjects: number }> {
  const before = await readBranches();
  if (!before.length) return { named: 0, classes: 0, subjects: 0 };
  const after = withBranchIds(before, randomUUID);
  const named = after.filter((b, i) => b.id !== before[i].id).length;
  if (named) await saveBranches(after);
  const first = after[0].id;
  const [c] = await db.update(classrooms).set({ branchId: first }).where(isNull(classrooms.branchId));
  const [s] = await db.update(subjects).set({ branchId: first }).where(isNull(subjects.branchId));
  return { named, classes: (c as { affectedRows?: number }).affectedRows ?? 0, subjects: (s as { affectedRows?: number }).affectedRows ?? 0 };
}

/** Branch ids among `ids` that still have classes or subjects — a branch like that can't be removed. */
export async function branchesInUse(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const [c, s] = await Promise.all([
    db.selectDistinct({ id: classrooms.branchId }).from(classrooms).where(and(inArray(classrooms.branchId, ids), eq(classrooms.isActive, true))),
    db.selectDistinct({ id: subjects.branchId }).from(subjects).where(inArray(subjects.branchId, ids)),
  ]);
  return [...new Set([...c, ...s].map(r => r.id).filter((x): x is string => !!x))];
}

const asLessons = (v: unknown): Record<string, number> | null => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v && typeof v === 'object' ? (v as Record<string, number>) : null;
};

async function branchContents(branchId: string) {
  const [cls, subs] = await Promise.all([
    db.select().from(classrooms).where(and(eq(classrooms.branchId, branchId), eq(classrooms.isActive, true))),
    db.select().from(subjects).where(eq(subjects.branchId, branchId)),
  ]);
  return {
    classes: cls.map(c => ({ id: c.id, name: c.name, capacity: c.capacity, startMinute: c.startMinute, endMinute: c.endMinute, daysOfWeek: c.daysOfWeek })),
    subjects: subs.map((s): CopySubject => ({ id: s.id, name: s.name, color: s.color, lessonsPerWeek: s.lessonsPerWeek, defaultDuration: s.defaultDuration, classLessons: asLessons(s.classLessons) })),
  };
}

/** Copy the classes and subjects of one branch (all, or the picked ones) to another, adding only what's missing there. */
export async function copyBranch(fromBranchId: string, toBranchId: string, pick: CopyPick = {}) {
  const [source, target] = await Promise.all([branchContents(fromBranchId), branchContents(toBranchId)]);
  const plan = planBranchCopy(source, target, randomUUID, pick);
  const now = new Date();
  await db.transaction(async tx => {
    if (plan.classes.length) {
      await tx.insert(classrooms).values(plan.classes.map(c => ({
        id: c.id, name: c.name, capacity: c.capacity, startMinute: c.startMinute, endMinute: c.endMinute, daysOfWeek: c.daysOfWeek as never,
        branchId: toBranchId, isActive: true, createdAt: now, updatedAt: now,
      })));
    }
    if (plan.subjects.length) {
      await tx.insert(subjects).values(plan.subjects.map(s => ({
        id: s.id, name: s.name, color: s.color, lessonsPerWeek: s.lessonsPerWeek, defaultDuration: s.defaultDuration,
        classLessons: s.classLessons as never, branchId: toBranchId, createdAt: now,
      })));
    }
  });
  return { addedClasses: plan.classes.length, addedSubjects: plan.subjects.length, skippedClasses: plan.skippedClasses, skippedSubjects: plan.skippedSubjects };
}
