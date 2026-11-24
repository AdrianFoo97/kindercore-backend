import { describe, it, expect } from 'vitest';
import { CATEGORIES_SHEET, LISTS_SHEET, MISSIONS_SHEET, MISSION_COLUMNS, isMissionTemplate, missionTemplateSheets, readMissionTemplate, type Rows } from '../../services/missionImport/template.js';

// Career missions → Import → the template read without AI. Made-up missions.

const sheet = (...rows: Rows): Rows => [[...MISSION_COLUMNS], ...rows];

describe('Career missions — the no-AI import template', () => {
  it('builds the template with today’s positions and categories to pick from', () => {
    const t = missionTemplateSheets({ positions: ['Junior EI', 'Senior EI'], categories: ['Classroom'] });
    expect(t[MISSIONS_SHEET][0]).toEqual([...MISSION_COLUMNS]);
    expect(t[LISTS_SHEET].slice(1, 3).map(r => r.slice(0, 2))).toEqual([['Junior EI', 'Classroom'], ['Senior EI', '']]);
    expect(isMissionTemplate(t)).toBe(true);
    expect(isMissionTemplate({ Sheet1: [['Mission', 'Position']] })).toBe(false);
  });

  it('reads missions and new categories exactly as written — any capitals, blank rows skipped, Yes/No and difficulty understood', () => {
    const result = readMissionTemplate({
      [MISSIONS_SHEET]: sheet(
        ['Junior EI', 'Classroom', 'Plan a weekly theme', 'Plan a week', '', 'Weekly plan', 'intermediate', 'yes', 'Y'],
        ['', '', '', '', '', '', '', '', ''],
        ['Senior EI', 'Wellbeing', 'Run a mindfulness corner', '', '', '', '', 'No', ''],
      ),
      [CATEGORIES_SHEET]: [['Category', 'Achievement name', 'Description'], ['Wellbeing', 'Wellbeing Champion', '']],
    });
    expect(result).toEqual({
      ok: true,
      draft: {
        categories: [{ name: 'Wellbeing', achievementName: 'Wellbeing Champion', description: null }],
        missions: [
          { title: 'Plan a weekly theme', position: 'Junior EI', category: 'Classroom', description: 'Plan a week', whyItMatters: null, evidenceRequirements: 'Weekly plan', difficulty: 'INTERMEDIATE', required: true, highPriority: true },
          { title: 'Run a mindfulness corner', position: 'Senior EI', category: 'Wellbeing', description: null, whyItMatters: null, evidenceRequirements: null, difficulty: 'BASIC', required: false, highPriority: false },
        ],
      },
    });
  });

  it('lists every value it can’t use, with its row — never guessing', () => {
    const result = readMissionTemplate({ [MISSIONS_SHEET]: sheet(['Junior EI', 'Classroom', '', '', '', '', 'Hard', 'Maybe', '']) });
    expect('problems' in result && result.problems).toEqual([
      'Career missions sheet, row 2: fill in the Mission.',
      'Career missions sheet, row 2: Difficulty must be Basic, Intermediate or Advanced.',
      'Career missions sheet, row 2: Required must be Yes or No.',
    ]);
    expect(readMissionTemplate({ [MISSIONS_SHEET]: sheet() })).toEqual({ ok: false, problems: ['Career missions sheet: add at least one mission.'] });
  });
});
