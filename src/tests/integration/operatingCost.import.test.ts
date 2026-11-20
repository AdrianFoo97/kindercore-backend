import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  operatingCostCategories, operatingCostCategoryGroups, operatingCostImportRules, operatingCostImports, operatingCosts, aiRequests, users,
} from '../../db/schema.js';
import { useAiForTests } from '../../services/ai/run.js';
import {
  applyImport, dismissNotice, ensureDefaultImportRules, importHistory, openNotices, previewImport, recordNotImportedLine, type ApplyInput,
} from '../../services/pnlImport.service.js';
import { bulkUpsertEntries } from '../../controllers/operatingCost.controller.js';
import { readImport } from '../../controllers/operatingCostImport.controller.js';
import { AiError } from '../../services/ai/types.js';
import { categories, CAT, entry, GROUP, groups } from '../fixtures/operatingCost.js';
import { makePdf, SAMPLE_PNL_LINES, SAMPLE_PNL_READING } from '../fixtures/pnlPdf.js';
import { activeUser } from '../fixtures/users.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';

// Import P&L, with a made-up statement and a fake reader in place of any AI
// service: preview saves nothing; applying writes what was decided, keeps
// what was already entered unless told to replace, and remembers choices.

const SEPT = 8; // months are stored 0-11
const FINANCE = { id: 'u-fin', email: 'fin@kindertech.test', isAdmin: false };
const ADMIN = { id: 'u-admin', email: 'admin@kindertech.test', isAdmin: true };
const PDF = makePdf(SAMPLE_PNL_LINES);

beforeEach(async () => {
  await resetTables(aiRequests, operatingCostImports, operatingCostImportRules, operatingCosts, operatingCostCategories, operatingCostCategoryGroups, users);
  await db.insert(operatingCostCategoryGroups).values(groups);
  await db.insert(operatingCostCategories).values(categories);
  await db.insert(users).values([
    await activeUser({ id: FINANCE.id, email: FINANCE.email, name: 'Fina Finance', role: 'USER' }),
    await activeUser({ id: ADMIN.id, email: ADMIN.email, name: 'Ada Admin' }),
  ]);
  await ensureDefaultImportRules();
  useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async () => ({ data: SAMPLE_PNL_READING, usage: { inputTokens: 900, outputTokens: 200 } }) } });
});
afterEach(() => useAiForTests(null));
afterAll(async () => { await pool.end(); });

const base = (lines: ApplyInput['lines'], newCategories: ApplyInput['newCategories'] = []): ApplyInput => ({
  year: 2026, month: 9, fileName: 'pnl-sep.pdf', provider: 'fake', model: 'fake-1', instructionsVersion: 1, lines, newCategories,
});
const rec = (name: string, amount: number, categoryId: string, extra: object = {}) =>
  ({ name, section: 'Administrative Expenses', amount, action: 'RECORD' as const, categoryId, ...extra });
const septEntries = async () => db.select().from(operatingCosts).where(and(eq(operatingCosts.year, 2026), eq(operatingCosts.month, SEPT)));

describe('Operating costs — Import P&L', () => {
  it('reads a P&L and previews it — checked against the file — recording the reading but saving nothing else', async () => {
    await db.insert(operatingCosts).values(entry(SEPT, CAT.rent, 4000));
    const p = await previewImport(PDF, FINANCE.id);
    expect(p).toMatchObject({ period: { year: 2026, month: 9 }, provider: 'fake', hasText: true });
    expect(p.sections.map(s => s.addsUp)).toEqual([true, true, true]);
    const status = Object.fromEntries(p.lines.map(l => [l.name, [l.status, l.found]]));
    expect(status).toEqual({
      Sales: ['NOT_A_COST', true], Rental: ['MATCHED', true], Petrol: ['MATCHED', true],
      'Fire Extinguisher': ['NEW', true], Salaries: ['SKIP_RULE', true],
    });
    expect(p.existing).toEqual({ [CAT.rent]: 4000 });
    expect((await septEntries()).length).toBe(1);
    // The reading itself is recorded (for the monthly limit), checks passed.
    expect(await db.select({ feature: aiRequests.feature, provider: aiRequests.provider, ok: aiRequests.ok, passedChecks: aiRequests.passedChecks, inputTokens: aiRequests.inputTokens }).from(aiRequests))
      .toEqual([{ feature: 'pnl-reading', provider: 'fake', ok: true, passedChecks: true, inputTokens: 900 }]);
  });

  it('records the chosen amounts marked as from the P&L, keeping an amount already entered unless told to replace', async () => {
    await db.insert(operatingCosts).values(entry(SEPT, CAT.rent, 4000));
    const r = await applyImport(base([rec('Rental', 4200, CAT.rent), rec('Petrol', 179.86, CAT.petrol)]), FINANCE);
    expect(r).toMatchObject({ recordedCount: 1, recordedTotal: 179.86, notImportedCount: 1 });
    const rows = await septEntries();
    expect(rows.find(x => x.categoryId === CAT.rent)).toMatchObject({ amount: 4000, importId: null });
    expect(rows.find(x => x.categoryId === CAT.petrol)).toMatchObject({ amount: 179.86, importId: r.importId });

    const again = await applyImport(base([rec('Rental', 4200, CAT.rent, { replace: true })]), FINANCE);
    expect((await septEntries()).find(x => x.categoryId === CAT.rent)).toMatchObject({ amount: 4200, importId: again.importId });
  });

  it('remembers a choice, so the next import sorts that line by itself', async () => {
    await applyImport(base([rec('Fire Extinguisher', 1570, CAT.capex, { remember: true })]), FINANCE);
    const p = await previewImport(PDF, FINANCE.id);
    expect(p.lines.find(l => l.name === 'Fire Extinguisher')).toMatchObject({ status: 'MATCHED', categoryId: CAT.capex });
  });

  it('shows what wasn’t imported on that month, with the amount and why, until dismissed', async () => {
    const r = await applyImport(base([
      rec('Petrol', 179.86, CAT.petrol),
      { name: 'Salaries', section: 'Staff Cost', amount: 2500, action: 'SKIP', categoryId: null, byRule: true },
      { name: 'Fire Extinguisher', section: 'Administrative Expenses', amount: 1570, action: 'SKIP', categoryId: null },
    ]), FINANCE);
    const [notice] = await openNotices(2026, SEPT);
    expect(notice).toMatchObject({ id: r.importId, importedByName: 'Fina Finance', recordedCount: 1 });
    expect(notice.notImported).toEqual([
      { name: 'Salaries', section: 'Staff Cost', amount: 2500, reason: 'Skipped by an import rule' },
      { name: 'Fire Extinguisher', section: 'Administrative Expenses', amount: 1570, reason: 'Skipped' },
    ]);
    expect(await dismissNotice(r.importId)).toBe(true);
    expect(await openNotices(2026, SEPT)).toEqual([]);
  });

  it('lets only an admin add a new category during an import', async () => {
    const withNew = base([rec('Fire Extinguisher', 1570, 'new:1')], [{ tempId: 'new:1', name: 'Fire Safety', groupId: GROUP.fixed }]);
    await expect(applyImport(withNew, FINANCE)).rejects.toThrow('Only an admin');
    await applyImport(withNew, ADMIN);
    const [cat] = await db.select().from(operatingCostCategories).where(eq(operatingCostCategories.name, 'Fire Safety'));
    expect((await septEntries()).find(x => x.categoryId === cat.id)?.amount).toBe(1570);
  });

  it('takes the “From P&L” mark off an amount someone changes by hand', async () => {
    await applyImport(base([rec('Petrol', 179.86, CAT.petrol)]), FINANCE);
    await bulkUpsertEntries(reqWith({ user: { id: FINANCE.id, email: FINANCE.email, role: 'USER' }, body: { year: 2026, rows: [{ categoryId: CAT.petrol, month: SEPT, amount: 200 }] } }), res());
    expect((await septEntries()).find(x => x.categoryId === CAT.petrol)).toMatchObject({ amount: 200, importId: null });
  });

  it('starts with payroll lines set to always skip, without undoing a rule someone changed', async () => {
    await db.update(operatingCostImportRules).set({ action: 'RECORD', categoryId: CAT.capex }).where(eq(operatingCostImportRules.lineKey, 'pcb'));
    await ensureDefaultImportRules();
    const rules = Object.fromEntries((await db.select().from(operatingCostImportRules)).map(r => [r.lineName, r.action]));
    expect(rules).toEqual({ Salaries: 'SKIP', PCB: 'RECORD', 'Director Remuneration': 'SKIP', 'Income Tax': 'SKIP' });
  });

  it('keeps a history of every import, newest first — even after its notice is dismissed', async () => {
    const first = await applyImport(base([rec('Petrol', 179.86, CAT.petrol)]), FINANCE);
    await dismissNotice(first.importId);
    const second = await applyImport({ ...base([{ name: 'Salaries', section: 'Staff Cost', amount: 2500, action: 'SKIP', categoryId: null, byRule: true }]), fileName: 'pnl-sep-v2.pdf' }, FINANCE);
    const history = await importHistory();
    expect(history.map(h => h.id)).toEqual([second.importId, first.importId]);
    expect(history[0]).toMatchObject({ fileName: 'pnl-sep-v2.pdf', month: SEPT, provider: 'fake', recordedCount: 0, importedByName: 'Fina Finance', dismissedAt: null });
    expect(history[1].dismissedAt).not.toBeNull();
  });

  it('reads without AI when asked — the same checks and statuses, and no AI request made', async () => {
    const p = await previewImport(PDF, FINANCE.id, { withoutAi: true });
    expect(p).toMatchObject({ provider: 'none', model: 'pdf-text', hasText: true, period: { year: 2026, month: 9 } });
    expect(p.sections.map(s => s.addsUp)).toEqual([true, true, true]);
    expect(Object.fromEntries(p.lines.map(l => [l.name, l.status]))).toEqual({
      Sales: 'NOT_A_COST', Rental: 'MATCHED', Petrol: 'MATCHED', 'Fire Extinguisher': 'NEW', Salaries: 'SKIP_RULE',
    });
    expect(await db.select().from(aiRequests)).toEqual([]);
  });

  it('when the AI can’t read it, says so with a code — so the page can offer to continue without AI', async () => {
    useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async () => { throw new AiError('Couldn’t reach the AI. Try again shortly.'); } } });
    const upload = (body: object) => {
      const rq = reqWith({ user: { id: FINANCE.id, email: FINANCE.email, role: 'USER' }, body });
      (rq as unknown as { file: object }).file = { buffer: PDF, originalname: 'pnl.pdf' };
      return rq;
    };
    const failed = res();
    await readImport(upload({}), failed);
    expect(failed.statusCode).toBe(422);
    expect(failed.body).toEqual({ message: 'Couldn’t reach the AI. Try again shortly.', code: 'AI_FAILED' });
    const without = res();
    await readImport(upload({ withoutAi: '1' }), without);
    expect(without.statusCode).toBe(200);
    expect(without.body).toMatchObject({ fileName: 'pnl.pdf', provider: 'none' });
  });

  it('records a line an import left out, asking first when that category already has an amount for the month', async () => {
    await db.insert(operatingCosts).values(entry(SEPT, CAT.rent, 4000));
    const r = await applyImport(base([
      { name: 'Fire Extinguisher', section: 'Administrative Expenses', amount: 1570, action: 'SKIP', categoryId: null },
      { name: 'Salaries', section: 'Staff Cost', amount: 2500, action: 'SKIP', categoryId: null, byRule: true },
    ]), FINANCE);

    // Into an empty category: recorded straight away, marked as from the P&L, off the list, remembered.
    expect(await recordNotImportedLine(r.importId, { index: 0, name: 'Fire Extinguisher', categoryId: CAT.capex, remember: true })).toEqual({ ok: true });
    expect((await septEntries()).find(x => x.categoryId === CAT.capex)).toMatchObject({ amount: 1570, importId: r.importId });
    const [notice] = await openNotices(2026, SEPT);
    expect(notice).toMatchObject({ recordedCount: 1, recordedTotal: 1570 });
    expect(notice.notImported.map(l => l.name)).toEqual(['Salaries']);
    expect((await previewImport(PDF, FINANCE.id)).lines.find(l => l.name === 'Fire Extinguisher')).toMatchObject({ status: 'MATCHED', categoryId: CAT.capex });

    // Into a category that already has an amount: asks first, then adds to it (or replaces) only when told.
    expect(await recordNotImportedLine(r.importId, { index: 0, name: 'Salaries', categoryId: CAT.rent })).toEqual({ ok: false, existingAmount: 4000 });
    expect((await septEntries()).find(x => x.categoryId === CAT.rent)?.amount).toBe(4000);
    await recordNotImportedLine(r.importId, { index: 0, name: 'Salaries', categoryId: CAT.rent, existing: 'add' });
    expect((await septEntries()).find(x => x.categoryId === CAT.rent)?.amount).toBe(6500);

    // The same line can't be recorded twice.
    await expect(recordNotImportedLine(r.importId, { index: 0, name: 'Salaries', categoryId: CAT.rent, existing: 'replace' })).rejects.toThrow('already been recorded');
  });
});
