import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';

// Staff onboarding has two checklists per new joiner, each copied from its
// template when the staff record is created:
//  - HR's list (staff_onboarding_tasks) — ticked on HR → Onboarding.
//  - Their own list (staff_self_onboarding_tasks) — ticked by the new joiner
//    in their app's "My onboarding" card (HR can tick it for them too).
// HR marks onboarding complete only once BOTH lists are done.

export const STAFF_ONBOARDING_SETTING = 'staff_onboarding_tasks';
export const STAFF_SELF_ONBOARDING_SETTING = 'staff_self_onboarding_tasks';

/** Seeded once on startup; admins tailor them in Settings → Staff Onboarding. */
export const DEFAULT_STAFF_ONBOARDING_TASKS = [
  'Collect a copy of IC and certificates',
  'Collect bank account details for salary',
  'Register for EPF, SOCSO and EIS',
  'Sign the employment contract',
  'Invite to the staff app (Settings → Team Members)',
  'Add to the staff WhatsApp group',
  'Walk through the How-To Guides for their role',
  'Hand over uniform and name tag',
];
export const DEFAULT_STAFF_SELF_ONBOARDING_TASKS = [
  'Read the staff handbook',
  'Read the How-To Guides for your role',
  'Learn the daily routine and timetable',
  'Meet your supervisor and buddy teacher',
  'Learn the emergency and fire-drill procedure',
  'Learn how to report an incident in the app',
];

export interface OnboardingTask { task: string; done: boolean }

type Executor = Pick<typeof db, 'select'>;

/** A stored checklist (JSON column — may arrive as a string or array) as a clean list. */
export function parseChecklist(raw: unknown): OnboardingTask[] {
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is { task: unknown; done?: unknown } => !!t && typeof t === 'object' && 'task' in t)
    .map(t => ({ task: String(t.task), done: t.done === true }));
}

/** True when there is nothing left to tick (an empty checklist counts as done). */
export function isChecklistDone(progress: OnboardingTask[]): boolean {
  return progress.every(t => t.done);
}

/** A fresh, all-unticked copy of a checklist template (HR's by default). */
export async function freshStaffChecklist(exec: Executor = db, settingKey: string = STAFF_ONBOARDING_SETTING): Promise<OnboardingTask[]> {
  const [row] = await exec.select().from(systemSettings).where(eq(systemSettings.key, settingKey)).limit(1);
  const raw = typeof row?.value === 'string' ? safeJson(row.value) : row?.value;
  const tasks = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : [];
  return tasks.map(task => ({ task, done: false }));
}

/** Both checklists a new joiner starts with. */
export async function freshStaffChecklists(exec: Executor = db): Promise<{ hr: OnboardingTask[]; self: OnboardingTask[] }> {
  return {
    hr: await freshStaffChecklist(exec, STAFF_ONBOARDING_SETTING),
    self: await freshStaffChecklist(exec, STAFF_SELF_ONBOARDING_SETTING),
  };
}

/**
 * Apply ticks to a checklist without letting the caller change the tasks
 * themselves — the new joiner can tick their own list, never rewrite it.
 * Returns null when the ticks don't line up with the tasks (stale screen).
 */
export function applyTicks(progress: OnboardingTask[], done: boolean[]): OnboardingTask[] | null {
  if (done.length !== progress.length) return null;
  return progress.map((t, i) => ({ task: t.task, done: done[i] }));
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
