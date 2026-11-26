import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';
import { SYSTEM_LOST_REASON_LABELS } from '../constants/lostReasons.js';
import { isAdminRole, resolveGrants } from '../middlewares/auth.middleware.js';
import { stripHiddenTemplates, visibleTemplateGroups } from '../services/messageTemplates.logic.js';
import { BRANCHES_SETTING, removedBranchIds, withBranchIds, type Branch } from '../services/branches.logic.js';
import { branchesInUse, readBranches } from '../services/branches.service.js';
import { CHECKLIST_SETTING_KEYS, checklistTemplateProblem, parseChecklistTemplate } from '../services/checklist.logic.js';

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.record(z.unknown()))]),
});

// Enforce system-pinned lost reasons at the boundary: they always come first
// and can't be removed, whatever the client sent (or didn't send).
function normalizeLostReasons(value: unknown): string[] {
  const incoming = Array.isArray(value)
    ? value.map(v => String(v).trim()).filter(Boolean)
    : [];
  // Drop any duplicates of system labels from the user section.
  const userOnly = incoming.filter(r => !SYSTEM_LOST_REASON_LABELS.includes(r));
  // De-dupe while preserving order.
  const seen = new Set<string>();
  const deduped = userOnly.filter(r => (seen.has(r) ? false : (seen.add(r), true)));
  return [...SYSTEM_LOST_REASON_LABELS, ...deduped];
}

export async function getSettings(req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(systemSettings).orderBy(asc(systemSettings.key));
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    // `secret.*` rows (e.g. the attendance reader key hash) are never sent
    // to the browser — this endpoint is readable by every signed-in user.
    if (row.key.startsWith('secret.')) continue;
    const val = row.value;
    result[row.key] = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return val; } })() : val;
  }
  // Always surface the system lost reasons, even if the stored value is
  // missing, malformed, or was written before the constant existed.
  result.lost_reasons = normalizeLostReasons(result.lost_reasons);
  // Message templates: Common for everyone, each other group only with its module.
  if (!isAdminRole(req.user?.role)) {
    const { modules } = await resolveGrants(req.user!.id);
    stripHiddenTemplates(result, visibleTemplateGroups(m => modules.has(m)));
  }
  res.json(result);
}

export async function updateSetting(req: Request, res: Response): Promise<void> {
  const { key } = req.params;
  // `secret.*` settings have their own endpoints (e.g. /api/admin/attendance-reader)
  // that hash what they store — never write them raw through this generic route.
  if (key.startsWith('secret.')) {
    res.status(403).json({ message: 'This setting can only be changed from its own settings page.' });
    return;
  }

  const parsed = updateSettingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const now = new Date();
  let val = parsed.data.value as any;
  if (key === 'lost_reasons') {
    val = normalizeLostReasons(val);
  }
  // Branches: each keeps a lasting id (classes and subjects point at it) — and
  // one that still has classes or subjects can't be removed.
  if (key === BRANCHES_SETTING) {
    if (!Array.isArray(val)) { res.status(400).json({ message: 'Branches must be a list.' }); return; }
    const next = withBranchIds(val as Branch[], randomUUID);
    const inUse = await branchesInUse(removedBranchIds(await readBranches(), next));
    if (inUse.length) { res.status(409).json({ message: 'A branch you removed still has classes or subjects — move or delete them first (Settings → Classes / Subjects).' }); return; }
    val = next;
  }
  // Onboarding checklists: every item needs text; a button needs a label and a safe link.
  if (CHECKLIST_SETTING_KEYS.includes(key)) {
    const problem = checklistTemplateProblem(val);
    if (problem) { res.status(400).json({ message: problem }); return; }
    val = parseChecklistTemplate(val);
  }

  // INSERT ... ON DUPLICATE KEY UPDATE (key has a UNIQUE constraint in DB)
  await db
    .insert(systemSettings)
    .values({ id: randomUUID(), key, value: val, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: val, updatedAt: now } });

  res.json({ key, value: val });
}
