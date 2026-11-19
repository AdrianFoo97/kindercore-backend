import { z } from 'zod';

// Onboarding checklists (students, HR's list for a new joiner, the joiner's
// own list). Each item is a line of text, optionally a description (shown on
// hover / tap), and, if the admin chose, a button with a link — e.g. "Fill in the EPF form" + [Open form](https://…).
// Templates live in settings; each student / new joiner gets a copy with ticks.
// Mirrored for the screens in kindercore-frontend/src/pages/checklistItems.ts.

export const CHECKLIST_SETTING_KEYS = ['onboarding_tasks', 'staff_onboarding_tasks', 'staff_self_onboarding_tasks'];

export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_TASK_LENGTH = 300;
export const MAX_LINK_LABEL_LENGTH = 40;
export const MAX_LINK_URL_LENGTH = 2000;
export const MAX_DESCRIPTION_LENGTH = 500;

export interface ChecklistItem { task: string; description?: string; linkLabel?: string; linkUrl?: string }
export interface ChecklistProgressItem extends ChecklistItem { done: boolean }

/** Why a link can't be used — or null when it can. Web addresses (http/https) or a page in this app ("/…"). */
export function checklistLinkProblem(url: string): string | null {
  const u = url.trim();
  if (!u) return 'Add the link the button opens.';
  if (u.length > MAX_LINK_URL_LENGTH) return 'That link is too long.';
  if (u.startsWith('/') && !u.startsWith('//')) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return null;
  } catch { /* not a URL */ }
  return 'Use a web address starting with https:// (or a page in the app starting with /).';
}

/** Why one checklist item can't be saved — or null when it can. */
export function checklistItemProblem(item: { task?: unknown; description?: unknown; linkLabel?: unknown; linkUrl?: unknown }): string | null {
  const task = typeof item.task === 'string' ? item.task.trim() : '';
  if (!task) return 'Every item needs some text.';
  if (task.length > MAX_TASK_LENGTH) return `Keep each item under ${MAX_TASK_LENGTH} characters.`;
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  if (description.length > MAX_DESCRIPTION_LENGTH) return `Keep the description of “${task}” under ${MAX_DESCRIPTION_LENGTH} characters.`;
  const label = typeof item.linkLabel === 'string' ? item.linkLabel.trim() : '';
  const url = typeof item.linkUrl === 'string' ? item.linkUrl.trim() : '';
  if (!label && !url) return null;
  if (!label) return `Give the button on “${task}” a label.`;
  if (label.length > MAX_LINK_LABEL_LENGTH) return `Keep button labels under ${MAX_LINK_LABEL_LENGTH} characters.`;
  const problem = checklistLinkProblem(url);
  return problem ? `“${task}”: ${problem}` : null;
}

/** One item in its clean stored form (the link only when it's complete and safe). */
function cleanItem(raw: unknown): ChecklistItem | null {
  if (typeof raw === 'string') return raw.trim() ? { task: raw.trim() } : null;
  if (!raw || typeof raw !== 'object' || !('task' in raw)) return null;
  const r = raw as { task: unknown; description?: unknown; linkLabel?: unknown; linkUrl?: unknown };
  const task = String(r.task ?? '').trim();
  if (!task) return null;
  const item: ChecklistItem = { task };
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (description) item.description = description;
  const label = typeof r.linkLabel === 'string' ? r.linkLabel.trim() : '';
  const url = typeof r.linkUrl === 'string' ? r.linkUrl.trim() : '';
  if (label && url && !checklistLinkProblem(url)) { item.linkLabel = label; item.linkUrl = url; }
  return item;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** A checklist template from settings — old plain-text lists and lists with links alike. */
export function parseChecklistTemplate(raw: unknown): ChecklistItem[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  return value.map(cleanItem).filter((x): x is ChecklistItem => !!x);
}

/** Why a whole template can't be saved — or null when it can. */
export function checklistTemplateProblem(raw: unknown): string | null {
  if (!Array.isArray(raw)) return 'A checklist is a list of items.';
  if (raw.length > MAX_CHECKLIST_ITEMS) return `A checklist can hold up to ${MAX_CHECKLIST_ITEMS} items.`;
  for (const item of raw) {
    const problem = checklistItemProblem(typeof item === 'string' ? { task: item } : (item ?? {}));
    if (problem) return problem;
  }
  return null;
}

/** A fresh, all-unticked copy of a template for a new student / joiner. */
export function freshChecklist(items: ChecklistItem[]): ChecklistProgressItem[] {
  return items.map(i => ({ ...i, done: false }));
}

/** Someone's ticked copy (JSON column — string or array) as a clean list, links kept. */
export function parseChecklistProgress(raw: unknown): ChecklistProgressItem[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  return value
    .map(r => {
      const item = cleanItem(r);
      return item ? { ...item, done: !!(r && typeof r === 'object' && (r as { done?: unknown }).done === true) } : null;
    })
    .filter((x): x is ChecklistProgressItem => !!x);
}

/** Request body item for saving ticks — the link, if sent, must be a complete, safe one. */
export const checklistProgressItemSchema = z.object({
  task: z.string().trim().min(1).max(MAX_TASK_LENGTH),
  done: z.boolean(),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
  linkLabel: z.string().trim().max(MAX_LINK_LABEL_LENGTH).optional(),
  linkUrl: z.string().trim().max(MAX_LINK_URL_LENGTH).optional(),
}).superRefine((item, ctx) => {
  const problem = checklistItemProblem(item);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});
