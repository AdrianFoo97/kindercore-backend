import type { MissionDraft } from './reading.js';

// Career missions → Import with AI: turning what the AI read into a preview
// the person checks (matched to the school's positions and categories, with
// anything already there flagged) — pure, unit-tested.

export interface PositionRef { positionId: string; name: string }
export interface CategoryRef { code: string; name: string }
export interface MissionRef { positionId: string; title: string }

/** Category codes are uppercase letters, digits and underscores (mission-categories.controller). */
export const MAX_CODE = 50;
/** New categories get these until someone changes them (both must be in the category form's lists). */
export const DEFAULT_ICON = 'faStar';
export const NEW_CATEGORY_COLORS = ['#1e40af', '#0e7490', '#15803d', '#b45309', '#5b21b6', '#0f766e', '#a21caf', '#475569'] as const;

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** "Classroom Care" → "CLASSROOM_CARE", unique among `taken`. */
export function categoryCode(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, MAX_CODE) || 'CATEGORY';
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base.slice(0, MAX_CODE - String(n).length - 1)}_${n}`;
  return code;
}

export interface PreviewCategory {
  /** Stable id for this preview (`new:<code>`, or the existing code). */
  key: string;
  name: string;
  achievementName: string;
  description: string | null;
  code: string;
  icon: string;
  color: string;
  /** Already a category with this name — nothing to create. */
  existingCode: string | null;
}

export interface PreviewMission {
  key: string;
  title: string;
  /** Matched position, or null for the person to pick. */
  positionId: string | null;
  /** What the document said, shown when it didn't match. */
  positionText: string | null;
  /** An existing category code, a new category's code, or null to pick. */
  categoryCode: string | null;
  description: string | null;
  whyItMatters: string | null;
  evidenceRequirements: string | null;
  difficulty: MissionDraft['missions'][number]['difficulty'];
  required: boolean;
  highPriority: boolean;
  /** A mission with this title already exists for that position. */
  duplicate: boolean;
}

export interface MissionPreview { categories: PreviewCategory[]; missions: PreviewMission[] }

export function previewFromDraft(draft: MissionDraft, positions: PositionRef[], categories: CategoryRef[], missions: MissionRef[]): MissionPreview {
  const positionByName = new Map(positions.flatMap(p => [[key(p.name), p.positionId], [key(p.positionId), p.positionId]] as const));
  const existingByName = new Map(categories.map(c => [key(c.name), c.code]));
  const taken = new Set(categories.map(c => c.code));
  const existingMission = new Set(missions.map(m => `${m.positionId}|${key(m.title)}`));

  // Categories: each name once — matched to an existing one, or a new one with a fresh code.
  const previewCategories: PreviewCategory[] = [];
  const codeByName = new Map(existingByName);
  for (const c of draft.categories) {
    if (previewCategories.some(p => key(p.name) === key(c.name))) continue;
    const existingCode = existingByName.get(key(c.name)) ?? null;
    const code = existingCode ?? categoryCode(c.name, taken);
    taken.add(code);
    codeByName.set(key(c.name), code);
    previewCategories.push({
      key: existingCode ?? `new:${code}`, name: c.name, achievementName: c.achievementName ?? c.name, description: c.description,
      code, icon: DEFAULT_ICON, color: NEW_CATEGORY_COLORS[previewCategories.filter(p => !p.existingCode).length % NEW_CATEGORY_COLORS.length],
      existingCode,
    });
  }

  const previewMissions: PreviewMission[] = draft.missions.map((m, i) => {
    const positionId = m.position ? positionByName.get(key(m.position)) ?? null : null;
    return {
      key: `m${i}`, title: m.title, positionId, positionText: positionId ? null : m.position,
      categoryCode: m.category ? codeByName.get(key(m.category)) ?? null : null,
      description: m.description, whyItMatters: m.whyItMatters, evidenceRequirements: m.evidenceRequirements,
      difficulty: m.difficulty, required: m.required, highPriority: m.highPriority,
      duplicate: !!positionId && existingMission.has(`${positionId}|${key(m.title)}`),
    };
  });
  return { categories: previewCategories, missions: previewMissions };
}
