import { randomUUID } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { careerMissions, missionCategories, positions } from '../../db/schema.js';
import { runAiTask, type AiLedger, type AiSetup } from '../ai/run.js';
import { MISSION_JSON_SCHEMA, MISSION_READING_FEATURE, missionDraftSchema, missionInstructions } from './reading.js';
import { previewFromDraft, type MissionPreview } from './plan.js';
import { TEMPLATE_FILE_NAME, isMissionTemplate, missionTemplateSheets, readMissionTemplate, type Rows } from './template.js';

// Settings → Career missions / Mission categories → Import with AI. Reads an
// Excel or PDF list with the AI (Settings → AI → HR), returns a preview for
// the person to check, and — only once they confirm — creates what they kept.

export { MISSION_READING_FEATURE } from './reading.js';
export { AiError as MissionReadError } from '../ai/types.js';

export type MissionFileKind = 'pdf' | 'xlsx';

/** A spreadsheet's text for the AI: every sheet as CSV, named. */
export const MAX_SHEET_TEXT = 200_000;
/** Column width in the downloaded template. */
const TEMPLATE_COLUMN_WIDTH = 24;

export class MissionImportProblem extends Error {
  /** `problems`: every row of a template that needs fixing (nothing is created until they are). */
  constructor(message: string, readonly status = 400, readonly problems: string[] = []) { super(message); }
}

/** How a file was read: by the AI, or straight from our template (no AI). */
export const READ_FROM_TEMPLATE = { provider: 'none', model: 'template' } as const;

/** What kind of file this is, from its first bytes (a browser's label is only a claim). */
export function fileKind(file: Buffer): MissionFileKind | null {
  if (file.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  if (file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04) return 'xlsx'; // a zip, as .xlsx files are
  return null;
}

function spreadsheetRows(file: Buffer): Record<string, Rows> {
  const wb = XLSX.read(file, { type: 'buffer' });
  return Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json<Rows[number]>(wb.Sheets[n], { header: 1, defval: '' })]));
}

function spreadsheetText(file: Buffer): string {
  const wb = XLSX.read(file, { type: 'buffer' });
  const text = wb.SheetNames.map(n => `# Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n').trim();
  if (!text.replace(/[#\s,]|Sheet:/g, '')) throw new MissionImportProblem('That spreadsheet is empty.');
  if (text.length > MAX_SHEET_TEXT) throw new MissionImportProblem('That spreadsheet is too big to read — split it into smaller files.');
  return text;
}

async function loadRefs() {
  const [positionRows, categoryRows, missionRows] = await Promise.all([
    db.select({ positionId: positions.positionId, name: positions.name }).from(positions),
    db.select({ code: missionCategories.code, name: missionCategories.name }).from(missionCategories),
    db.select({ positionId: careerMissions.positionId, title: careerMissions.title }).from(careerMissions).where(isNull(careerMissions.deletedAt)),
  ]);
  return { positionRows, categoryRows, missionRows };
}

export interface MissionReading extends MissionPreview { provider: string; model: string; backupReason: string | null }

/** Read the file with the AI and match it to the school's positions and categories. Saves nothing. */
export async function readMissionFile(file: Buffer, userId: string, setup?: AiSetup, ledger?: AiLedger): Promise<MissionReading> {
  const kind = fileKind(file);
  if (!kind) throw new MissionImportProblem('Choose an Excel (.xlsx) or PDF file.');
  const refs = await loadRefs();
  // Our template is read as it is — no AI, nothing guessed.
  if (kind === 'xlsx') {
    const sheets = spreadsheetRows(file);
    if (isMissionTemplate(sheets)) {
      const result = readMissionTemplate(sheets);
      if ('problems' in result) throw new MissionImportProblem('Fix these in the file, then import it again.', 400, result.problems);
      return { ...previewFromDraft(result.draft, refs.positionRows, refs.categoryRows, refs.missionRows), ...READ_FROM_TEMPLATE, backupReason: null };
    }
  }
  const run = await runAiTask(MISSION_READING_FEATURE, {
    instructions: missionInstructions(refs.positionRows.map(p => p.name), refs.categoryRows.map(c => c.name)),
    schema: { ...MISSION_JSON_SCHEMA },
    schemaName: 'career_missions',
    ...(kind === 'pdf' ? { pdf: file } : { documentText: spreadsheetText(file) }),
  }, {
    userId,
    parse: data => { const p = missionDraftSchema.safeParse(data); return p.success ? p.data : null; },
    passes: draft => draft.missions.length > 0,
    incompleteMessage: 'The AI couldn’t find any career missions in that file.',
  }, setup, ledger);
  return {
    ...previewFromDraft(run.result, refs.positionRows, refs.categoryRows, refs.missionRows),
    provider: run.provider, model: run.model, backupReason: run.backupReason,
  };
}

export interface NewCategory { code: string; name: string; achievementName: string; description: string | null; icon: string; color: string }
export interface NewMission {
  positionId: string; title: string; category: string; description: string | null; whyItMatters: string | null;
  evidenceRequirements: string | null; difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'; required: boolean; highPriority: boolean;
}

/**
 * Create what the person kept — all or nothing. Categories first (a code
 * already taken is refused), then missions, each appended to the end of its
 * position's list. Every position and category must exist by then.
 */
export async function applyMissionImport(input: { categories: NewCategory[]; missions: NewMission[] }): Promise<{ categories: number; missions: number }> {
  const refs = await loadRefs();
  const taken = new Set(refs.categoryRows.map(c => c.code));
  for (const c of input.categories) {
    if (taken.has(c.code)) throw new MissionImportProblem(`There’s already a category with the code ${c.code}.`, 409);
    taken.add(c.code);
  }
  const positionIds = new Set(refs.positionRows.map(p => p.positionId));
  for (const m of input.missions) {
    if (!positionIds.has(m.positionId)) throw new MissionImportProblem(`“${m.title}”: that position doesn’t exist.`);
    if (!taken.has(m.category)) throw new MissionImportProblem(`“${m.title}”: that category doesn’t exist.`);
  }

  const now = new Date();
  await db.transaction(async tx => {
    const [{ maxSort }] = await tx.select({ maxSort: sql<number>`COALESCE(MAX(${missionCategories.sortOrder}), -1)` }).from(missionCategories);
    let sortOrder = Number(maxSort) + 1;
    for (const c of input.categories) {
      await tx.insert(missionCategories).values({ ...c, sortOrder: sortOrder++, createdAt: now, updatedAt: now });
    }
    const nextOrder = new Map<string, number>();
    for (const m of input.missions) {
      if (!nextOrder.has(m.positionId)) {
        const [{ max }] = await tx.select({ max: sql<number>`COALESCE(MAX(${careerMissions.displayOrder}), -1)` })
          .from(careerMissions).where(and(eq(careerMissions.positionId, m.positionId), isNull(careerMissions.deletedAt)));
        nextOrder.set(m.positionId, Number(max) + 1);
      }
      const displayOrder = nextOrder.get(m.positionId)!;
      nextOrder.set(m.positionId, displayOrder + 1);
      await tx.insert(careerMissions).values({ id: randomUUID(), ...m, displayOrder, createdAt: now, updatedAt: now });
    }
  });
  return { categories: input.categories.length, missions: input.missions.length };
}

/** The no-AI template, with today's positions and categories on its Lists sheet. */
export async function missionTemplateFile(): Promise<{ fileName: string; file: Buffer }> {
  const { positionRows, categoryRows } = await loadRefs();
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(missionTemplateSheets({ positions: positionRows.map(p => p.name), categories: categoryRows.map(c => c.name) }))) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map(() => ({ wch: TEMPLATE_COLUMN_WIDTH }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return { fileName: TEMPLATE_FILE_NAME, file: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}
