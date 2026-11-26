// Branches (Settings → Company → Branches) and the classes / subjects that
// belong to one. Pure rules, unit-tested — no database here.

/** One branch as stored in the `company_branches` setting. `id` never changes, so renaming a branch keeps its classes. */
export interface Branch { id?: string; name: string; address?: string; mapsUrl?: string }

export const BRANCHES_SETTING = 'company_branches';

/** The list with every branch given a lasting id (new ones get `newId()`); everything else kept as is. */
export function withBranchIds<T extends Branch>(list: T[], newId: () => string): (T & { id: string })[] {
  return list.map(b => ({ ...b, id: b.id && b.id.trim() ? b.id : newId() }));
}

/** Branch ids in `before` that are gone from `after`. */
export function removedBranchIds(before: Branch[], after: Branch[]): string[] {
  const kept = new Set(after.map(b => b.id).filter(Boolean));
  return before.map(b => b.id).filter((id): id is string => !!id && !kept.has(id));
}

export interface CopyClass { id: string; name: string; capacity: number | null; startMinute: number | null; endMinute: number | null; daysOfWeek: unknown }
export interface CopySubject { id: string; name: string; color: string; lessonsPerWeek: number | null; defaultDuration: number | null; classLessons: Record<string, number> | null }

/** Names compared the way people read them: spaces and case don't make a different class. */
const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Only these classes / subjects (by id); a list left out means all of them, an empty list means none. */
export interface CopyPick { classIds?: string[]; subjectIds?: string[] }

/**
 * Copy the classes and subjects of one branch (all, or the picked ones) to
 * another, adding only what's missing there (same name = already there, left
 * as it is). A copied subject's "lessons per class" point at the target
 * branch's class of the same name — dropped for a class it doesn't have.
 */
export function planBranchCopy(
  source: { classes: CopyClass[]; subjects: CopySubject[] },
  target: { classes: CopyClass[]; subjects: CopySubject[] },
  newId: () => string,
  pick: CopyPick = {},
) {
  const picked = <T extends { id: string }>(list: T[], ids?: string[]) => (ids ? list.filter(x => ids.includes(x.id)) : list);
  const sourceClasses = picked(source.classes, pick.classIds);
  const sourceSubjects = picked(source.subjects, pick.subjectIds);
  const targetClassByName = new Map(target.classes.map(c => [key(c.name), c.id]));
  const classes: CopyClass[] = [];
  for (const c of sourceClasses) {
    if (targetClassByName.has(key(c.name))) continue;
    const copy = { ...c, id: newId() };
    classes.push(copy);
    targetClassByName.set(key(c.name), copy.id);
  }
  const sourceClassName = new Map(source.classes.map(c => [c.id, key(c.name)]));
  const targetSubjects = new Set(target.subjects.map(s => key(s.name)));
  const subjects: CopySubject[] = [];
  for (const s of sourceSubjects) {
    if (targetSubjects.has(key(s.name))) continue;
    targetSubjects.add(key(s.name));
    let classLessons: Record<string, number> | null = null;
    for (const [classId, lessons] of Object.entries(s.classLessons ?? {})) {
      const name = sourceClassName.get(classId);
      const to = name ? targetClassByName.get(name) : undefined;
      if (to) (classLessons ??= {})[to] = lessons;
    }
    subjects.push({ ...s, id: newId(), classLessons });
  }
  return {
    classes,
    subjects,
    skippedClasses: sourceClasses.length - classes.length,
    skippedSubjects: sourceSubjects.length - subjects.length,
  };
}
