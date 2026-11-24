import { DIFFICULTIES, MAX_CATEGORY_NAME, MAX_TITLE, type MissionDraft } from './reading.js';

// Career missions → Import → the no-AI template: its layout, and reading a
// filled-in one straight into the same draft the AI would give. Pure.
// Nothing is guessed: a Difficulty, Required or High priority that isn't one
// of the allowed values is listed with its row, so the file can be fixed.

export const TEMPLATE_FILE_NAME = 'career-missions-import-template.xlsx';
export const MISSIONS_SHEET = 'Career missions';
export const CATEGORIES_SHEET = 'New categories';
export const LISTS_SHEET = 'Lists';

export const MISSION_COLUMNS = ['Position', 'Category', 'Mission', 'Description', 'Why it matters', 'Evidence', 'Difficulty', 'Required', 'High priority'] as const;
export const CATEGORY_COLUMNS = ['Category', 'Achievement name', 'Description'] as const;

const DIFFICULTY_BY_LABEL: Record<string, MissionDraft['missions'][number]['difficulty']> = Object.fromEntries(DIFFICULTIES.map(d => [d.toLowerCase(), d]));
const YES = new Set(['yes', 'y', 'true']);
const NO = new Set(['no', 'n', 'false']);

type Cell = string | number | boolean | null | undefined;
export type Rows = Cell[][];

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c)).trim();
const key = (s: string) => s.trim().toLowerCase();

/** The template's sheets as rows — the Lists sheet carries the positions and categories that exist today. */
export function missionTemplateSheets(refs: { positions: string[]; categories: string[] }): Record<string, Rows> {
  const longest = Math.max(refs.positions.length, refs.categories.length);
  return {
    [MISSIONS_SHEET]: [[...MISSION_COLUMNS]],
    [CATEGORIES_SHEET]: [[...CATEGORY_COLUMNS]],
    [LISTS_SHEET]: [
      ['Positions', 'Categories', 'Difficulty', 'Required / High priority'],
      ...Array.from({ length: Math.max(longest, DIFFICULTIES.length) }, (_, i) => [
        refs.positions[i] ?? '', refs.categories[i] ?? '',
        DIFFICULTIES[i] ? DIFFICULTIES[i][0] + DIFFICULTIES[i].slice(1).toLowerCase() : '', i === 0 ? 'Yes' : i === 1 ? 'No' : '',
      ]),
    ],
  };
}

const sameHeader = (row: Cell[] | undefined, columns: readonly string[]) => columns.every((c, i) => key(text(row?.[i])) === key(c));

/** Is this our template? (Its missions sheet with our columns.) Anything else goes to the AI. */
export function isMissionTemplate(sheets: Record<string, Rows | undefined>): boolean {
  return sameHeader(sheets[MISSIONS_SHEET]?.[0], MISSION_COLUMNS);
}

export type TemplateResult = { ok: true; draft: MissionDraft } | { ok: false; problems: string[] };

/** Read a filled-in template into the same draft the AI gives. */
export function readMissionTemplate(sheets: Record<string, Rows | undefined>): TemplateResult {
  const problems: string[] = [];
  const missions: MissionDraft['missions'] = [];
  (sheets[MISSIONS_SHEET] ?? []).slice(1).forEach((row, i) => {
    const [position, category, title, description, why, evidence, difficulty, required, priority] = MISSION_COLUMNS.map((_, c) => text(row?.[c]));
    if (![position, category, title, description, why, evidence, difficulty, required, priority].some(Boolean)) return;
    const where = `${MISSIONS_SHEET} sheet, row ${i + 2}`;
    if (!title) problems.push(`${where}: fill in the Mission.`);
    else if (title.length > MAX_TITLE) problems.push(`${where}: the Mission is longer than ${MAX_TITLE} characters.`);
    const level = difficulty ? DIFFICULTY_BY_LABEL[key(difficulty)] : 'BASIC';
    if (!level) problems.push(`${where}: Difficulty must be Basic, Intermediate or Advanced.`);
    const yesNo = (value: string, label: string, blank: boolean) => {
      if (!value) return blank;
      if (YES.has(key(value))) return true;
      if (NO.has(key(value))) return false;
      problems.push(`${where}: ${label} must be Yes or No.`);
      return blank;
    };
    missions.push({
      title, position: position || null, category: category || null,
      description: description || null, whyItMatters: why || null, evidenceRequirements: evidence || null,
      difficulty: level ?? 'BASIC', required: yesNo(required, 'Required', true), highPriority: yesNo(priority, 'High priority', false),
    });
  });
  if (missions.length === 0 && problems.length === 0) problems.push(`${MISSIONS_SHEET} sheet: add at least one mission.`);

  const categories: MissionDraft['categories'] = [];
  (sheets[CATEGORIES_SHEET] ?? []).slice(1).forEach((row, i) => {
    const [name, achievement, description] = CATEGORY_COLUMNS.map((_, c) => text(row?.[c]));
    if (!name && !achievement && !description) return;
    if (!name) { problems.push(`${CATEGORIES_SHEET} sheet, row ${i + 2}: fill in the Category.`); return; }
    if (name.length > MAX_CATEGORY_NAME) { problems.push(`${CATEGORIES_SHEET} sheet, row ${i + 2}: the Category is too long.`); return; }
    categories.push({ name, achievementName: achievement || null, description: description || null });
  });
  return problems.length ? { ok: false, problems } : { ok: true, draft: { categories, missions } };
}
