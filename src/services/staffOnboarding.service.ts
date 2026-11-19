import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';
import { type ChecklistProgressItem, freshChecklist, parseChecklistProgress, parseChecklistTemplate } from './checklist.logic.js';

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

/** One ticked item — text, done, and the item's link button if the template had one. */
export type OnboardingTask = ChecklistProgressItem;

type Executor = Pick<typeof db, 'select'>;

/** A stored checklist (JSON column — may arrive as a string or array) as a clean list. */
export function parseChecklist(raw: unknown): OnboardingTask[] {
  return parseChecklistProgress(raw);
}

/** True when there is nothing left to tick (an empty checklist counts as done). */
export function isChecklistDone(progress: OnboardingTask[]): boolean {
  return progress.every(t => t.done);
}

/** A fresh, all-unticked copy of a checklist template (HR's by default). */
export async function freshStaffChecklist(exec: Executor = db, settingKey: string = STAFF_ONBOARDING_SETTING): Promise<OnboardingTask[]> {
  const [row] = await exec.select().from(systemSettings).where(eq(systemSettings.key, settingKey)).limit(1);
  return freshChecklist(parseChecklistTemplate(row?.value));
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
  return progress.map((t, i) => ({ ...t, done: done[i] }));
}

