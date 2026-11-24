import { describe, it, expect } from 'vitest';
import { MAX_AI_POSTER_STEPS, posterProblem, posterPrompt } from '../../services/guidePoster/prompt.js';

// How-To Guide → AI poster: what the image model is asked to draw.

const guide = { title: 'Picking', goal: 'Pick the right items, first time' };

describe('AI guide poster — the drawing request', () => {
  it('asks for every step, numbered in order, with its exact wording — including Chinese', () => {
    const prompt = posterPrompt(guide, [
      { section: 'Main', title: 'Scan the  task\nlabel' },
      { section: 'Main', title: '核对数量' },
      { section: 'Main', title: 'Box up for review' },
    ]);
    expect(prompt).toContain('Title: "Picking"');
    expect(prompt).toContain('Subtitle: "Pick the right items, first time"');
    const at = ['1. "Scan the task label"', '2. "核对数量"', '3. "Box up for review"'].map(l => prompt.indexOf(l));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(prompt).toMatch(/spelled exactly as written/);
    expect(prompt).not.toContain('Section:'); // one section → no headings
  });

  it('adds section headings only when the guide has more than one section', () => {
    const prompt = posterPrompt({ title: 'Arrival', goal: null }, [
      { section: 'Before class', title: 'Open the gate' },
      { section: 'During class', title: 'Take attendance' },
    ]);
    expect(prompt.indexOf('Section: "Before class"')).toBeLessThan(prompt.indexOf('1. "Open the gate"'));
    expect(prompt.indexOf('Section: "During class"')).toBeLessThan(prompt.indexOf('2. "Take attendance"'));
    expect(prompt).not.toContain('Subtitle');
  });

  it(`refuses a guide with no steps, or more than ${MAX_AI_POSTER_STEPS}`, () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ section: 'Main', title: `Step ${i}` }));
    expect(posterProblem([])).toMatch(/Add steps/);
    expect(posterProblem(steps(MAX_AI_POSTER_STEPS))).toBeNull();
    expect(posterProblem(steps(MAX_AI_POSTER_STEPS + 1))).toMatch(/up to 16/);
  });
});
