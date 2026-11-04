import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { allowanceTypes, careerRecords, positions, teacherAllowances, teachers } from '../db/schema.js';
import { freshStaffChecklists } from './staffOnboarding.service.js';

// The one way a person becomes staff: creates the Teacher row, seeds their
// career history at the join date, and stores their allowances. Used by
// Recruitment → Hire and HR → New Staff → Approve, so both paths produce
// exactly the same record.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface NewStaffDetails {
  name: string;
  phone: string;
  dob?: string | null;
  positionId: string;
  level: number;
  employmentType: 'full-time' | 'part-time';
  joinDate: string;
  salaryType: 'formula' | 'fixed' | 'hourly';
  fixedSalaryAmount?: number;
  hourlyRate?: number;
  hasEpf: boolean;
  hasSocso: boolean;
  hasEis: boolean;
  workStartMinute?: number;
  workEndMinute?: number;
  workDays?: number[];
  allowances?: { allowanceTypeId: string; amount: number }[];
}

export class StaffRecordError extends Error {}

const TEACHER_COLOR_PRESETS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#0ea5e9', '#14b8a6', '#a855f7'];
const RANDOM_COLOR_ATTEMPTS = 50;

/** Creates the staff record inside the caller's transaction; returns the new teacher id. */
export async function createStaffRecord(tx: Tx, details: NewStaffDetails): Promise<string> {
  const [position] = await tx.select().from(positions).where(eq(positions.positionId, details.positionId)).limit(1);
  if (!position) throw new StaffRecordError('Position not found');

  const allowanceEntries = await validAllowances(tx, details.allowances ?? []);
  const usedColors = (await tx.select({ color: teachers.color }).from(teachers)).map(t => t.color);
  const checklists = await freshStaffChecklists(tx);

  const now = new Date();
  const joinDate = new Date(details.joinDate);
  const teacherId = randomUUID();

  await tx.insert(teachers).values({
    id: teacherId,
    name: details.name,
    color: pickTeacherColor(usedColors),
    phone: details.phone,
    dob: details.dob ? new Date(details.dob) : null,
    employmentType: details.employmentType,
    positionId: details.positionId,
    level: details.level,
    isFixedSalary: details.salaryType === 'fixed',
    fixedSalaryAmount: details.salaryType === 'fixed' ? details.fixedSalaryAmount ?? null : null,
    salaryType: details.salaryType,
    hourlyRate: details.salaryType === 'hourly' ? details.hourlyRate ?? null : null,
    hasEpf: details.hasEpf,
    hasSocso: details.hasSocso,
    hasEis: details.hasEis,
    workStartMinute: details.workStartMinute ?? null,
    workEndMinute: details.workEndMinute ?? null,
    workDays: details.workDays ?? null,
    // Every new staff member starts on HR → Onboarding.
    onboardingProgress: checklists.hr,
    selfOnboardingProgress: checklists.self,
    onboardingCompleted: false,
    createdAt: joinDate,
    updatedAt: now,
  });
  // Career history starts at the join date, so promotions are dated from it.
  await tx.insert(careerRecords).values({
    id: randomUUID(),
    teacherId,
    positionId: details.positionId,
    level: details.level,
    effectiveDate: joinDate,
    notes: null,
    createdAt: now,
  });
  for (const entry of allowanceEntries) {
    await tx.insert(teacherAllowances).values({
      id: randomUUID(),
      teacherId,
      allowanceTypeId: entry.allowanceTypeId,
      amount: entry.amount,
      updatedAt: now,
    });
  }
  return teacherId;
}

/** Drops zero amounts and ids that aren't real allowance types (stale client data). */
async function validAllowances(tx: Tx, entries: { allowanceTypeId: string; amount: number }[]) {
  const validIds = new Set((await tx.select({ id: allowanceTypes.id }).from(allowanceTypes)).map(t => t.id));
  return entries.filter(a => a.amount > 0 && validIds.has(a.allowanceTypeId));
}

/** Mirrors EditTeacherPage's pickUnusedColor — first unused preset, else a random hex. */
function pickTeacherColor(usedColors: (string | null)[]): string {
  const used = new Set(usedColors.filter((c): c is string => !!c).map(c => c.toLowerCase()));
  const available = TEACHER_COLOR_PRESETS.find(c => !used.has(c.toLowerCase()));
  if (available) return available;
  for (let i = 0; i < RANDOM_COLOR_ATTEMPTS; i++) {
    const c = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
    if (!used.has(c)) return c;
  }
  return TEACHER_COLOR_PRESETS[0];
}
