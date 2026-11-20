import type { Request, Response } from 'express';
import { z } from 'zod';
import { addImportRule, deleteImportRule, listImportRules, updateImportRule, type RuleInput } from '../services/pnlImportRules.service.js';
import { ImportProblem } from '../services/pnlImport.service.js';

// Settings → Operating cost → Import rules (admins): what a P&L import does
// with each line name. (The AI that reads P&Ls is set up in Settings → AI.)

const ruleSchema = z.object({ action: z.enum(['RECORD', 'SKIP']), categoryId: z.string().max(36).nullable().default(null) });

async function withProblems(res: Response, run: () => Promise<void>): Promise<void> {
  try { await run(); } catch (e) {
    if (e instanceof ImportProblem) { res.status(e.status).json({ message: e.message }); return; }
    throw e;
  }
}

export async function getImportRules(_req: Request, res: Response): Promise<void> {
  res.json(await listImportRules());
}

export async function postImportRule(req: Request, res: Response): Promise<void> {
  const parsed = ruleSchema.extend({ lineName: z.string().trim().min(1).max(191) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Enter the line name and what to do with it.' }); return; }
  await withProblems(res, async () => {
    await addImportRule(parsed.data.lineName!, parsed.data as RuleInput);
    res.status(201).json(await listImportRules());
  });
}

export async function putImportRule(req: Request, res: Response): Promise<void> {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Choose what to do with this line.' }); return; }
  await withProblems(res, async () => {
    if (!(await updateImportRule(req.params.id, parsed.data as RuleInput))) { res.status(404).json({ message: 'Rule not found' }); return; }
    res.json(await listImportRules());
  });
}

export async function removeImportRule(req: Request, res: Response): Promise<void> {
  if (!(await deleteImportRule(req.params.id))) { res.status(404).json({ message: 'Rule not found' }); return; }
  res.json(await listImportRules());
}
