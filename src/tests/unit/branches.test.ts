import { describe, it, expect } from 'vitest';
import { planBranchCopy, removedBranchIds, withBranchIds, type CopyClass, type CopySubject } from '../../services/branches.logic.js';

// Branches — lasting ids, and copying one branch's classes and subjects to another.

let n = 0;
const nextId = () => `new-${++n}`;
const cls = (id: string, name: string): CopyClass => ({ id, name, capacity: 20, startMinute: 480, endMinute: 780, daysOfWeek: [0, 1, 2, 3, 4] });
const sub = (id: string, name: string, classLessons: Record<string, number> | null): CopySubject => ({ id, name, color: '#22c55e', lessonsPerWeek: null, defaultDuration: 60, classLessons });

describe('Branches', () => {
  it('gives every branch a lasting id, keeping the ones it has — and spots a removed branch', () => {
    const list = withBranchIds([{ id: 'b1', name: 'Bukit Indah' }, { name: 'Skudai' }], () => 'b2');
    expect(list.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(removedBranchIds(list, [{ id: 'b2', name: 'Skudai (renamed)' }])).toEqual(['b1']);
    expect(removedBranchIds(list, list)).toEqual([]);
  });

  it('copies every class and subject, pointing each subject’s lessons at the new branch’s classes', () => {
    const source = { classes: [cls('n1', 'N1'), cls('n2', 'N2')], subjects: [sub('maths', 'Math', { n1: 3, n2: 2 })] };
    const plan = planBranchCopy(source, { classes: [], subjects: [] }, nextId);
    expect(plan.classes.map(c => c.name)).toEqual(['N1', 'N2']);
    const [n1, n2] = plan.classes.map(c => c.id);
    expect(plan.subjects[0]).toMatchObject({ name: 'Math', classLessons: { [n1]: 3, [n2]: 2 } });
    expect(plan.classes[0]).toMatchObject({ capacity: 20, startMinute: 480 });
  });

  it('copies just the picked classes or subjects — a subject keeps lessons only for classes the other branch has', () => {
    const source = { classes: [cls('n1', 'N1'), cls('n2', 'N2')], subjects: [sub('m', 'Math', { n1: 3, n2: 2 }), sub('e', 'English', null)] };
    const target = { classes: [cls('t-n1', 'N1')], subjects: [] };
    const onlyN2 = planBranchCopy(source, target, nextId, { classIds: ['n2'], subjectIds: [] });
    expect(onlyN2.classes.map(c => c.name)).toEqual(['N2']);
    expect(onlyN2.subjects).toEqual([]);
    const onlyMath = planBranchCopy(source, target, nextId, { classIds: [], subjectIds: ['m'] });
    expect(onlyMath.classes).toEqual([]);
    expect(onlyMath.subjects.map(s => [s.name, s.classLessons])).toEqual([['Math', { 't-n1': 3 }]]);
  });

  it('adds only what’s missing — same name (any case or spacing) is already there — so running it twice adds nothing', () => {
    const source = { classes: [cls('n1', 'N1'), cls('p1', 'P1')], subjects: [sub('m', 'Math', { n1: 3, p1: 1 }), sub('e', 'English', null)] };
    const target = { classes: [cls('t-n1', ' n1 ')], subjects: [sub('t-e', 'english', null)] };
    const plan = planBranchCopy(source, target, nextId);
    expect(plan.classes.map(c => c.name)).toEqual(['P1']);
    expect(plan.subjects.map(s => s.name)).toEqual(['Math']);
    // Math's N1 lessons go to the N1 already at the target branch.
    expect(plan.subjects[0].classLessons).toEqual({ 't-n1': 3, [plan.classes[0].id]: 1 });
    expect(plan).toMatchObject({ skippedClasses: 1, skippedSubjects: 1 });
    const again = planBranchCopy(source, { classes: [...target.classes, ...plan.classes], subjects: [...target.subjects, ...plan.subjects] }, nextId);
    expect(again.classes.length + again.subjects.length).toBe(0);
  });
});
