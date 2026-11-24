import { describe, it, expect } from 'vitest';
import { categoryCode, previewFromDraft } from '../../services/missionImport/plan.js';
import type { MissionDraft } from '../../services/missionImport/reading.js';

// Career missions → Import with AI: what the AI read, matched for the person to check.

const mission = (title: string, position: string | null, category: string | null): MissionDraft['missions'][number] => ({
  title, position, category, description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'BASIC', required: true, highPriority: false,
});

describe('Career missions — import preview', () => {
  it('makes a category code from its name, never reusing one that’s taken', () => {
    expect(categoryCode('Classroom Care & Safety', new Set())).toBe('CLASSROOM_CARE_SAFETY');
    expect(categoryCode('Safety', new Set(['SAFETY', 'SAFETY_2']))).toBe('SAFETY_3');
    expect(categoryCode('!!!', new Set())).toBe('CATEGORY');
  });

  it('matches positions and categories by name (any capitals), keeps unmatched text to pick from, and flags missions that already exist', () => {
    const preview = previewFromDraft(
      {
        categories: [{ name: 'Teaching', achievementName: null, description: null }, { name: 'Parent Care', achievementName: 'Parent Pro', description: 'Talking with parents' }],
        missions: [mission('Lead circle time', 'junior ei', 'teaching'), mission('Run open day', 'Head Chef', 'Parent Care'), mission('Read a story', 'EI', null)],
      },
      [{ positionId: 'EI', name: 'Junior EI' }],
      [{ code: 'TEACH', name: 'Teaching' }],
      [{ positionId: 'EI', title: 'Lead Circle Time' }],
    );
    expect(preview.categories).toMatchObject([
      { name: 'Teaching', existingCode: 'TEACH', code: 'TEACH' },
      { name: 'Parent Care', existingCode: null, code: 'PARENT_CARE', achievementName: 'Parent Pro', key: 'new:PARENT_CARE' },
    ]);
    expect(preview.missions.map(m => [m.title, m.positionId, m.positionText, m.categoryCode, m.duplicate])).toEqual([
      ['Lead circle time', 'EI', null, 'TEACH', true],
      ['Run open day', null, 'Head Chef', 'PARENT_CARE', false],
      ['Read a story', 'EI', null, null, false],
    ]);
  });
});
