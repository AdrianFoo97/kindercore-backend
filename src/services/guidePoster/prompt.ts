// How-To Guide → AI poster: what the image model is asked to draw. Pure — so
// it can be checked that every step goes in, in order, worded exactly.

/** More than this and one poster gets too crowded to read (and the AI starts dropping steps). */
export const MAX_AI_POSTER_STEPS = 16;

export interface PosterGuide { title: string; goal: string | null }
export interface PosterPromptStep { section: string; title: string }

/** One line of text — newlines and runs of spaces collapsed, so the model reads it as one label. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Why this guide can't be drawn as one poster, or null when it can. */
export function posterProblem(steps: PosterPromptStep[]): string | null {
  if (!steps.length) return 'Add steps to this guide first — the poster shows its steps.';
  if (steps.length > MAX_AI_POSTER_STEPS) return `This guide has ${steps.length} steps — an AI poster fits up to ${MAX_AI_POSTER_STEPS}. Split the guide, or use the simple poster.`;
  return null;
}

export function posterPrompt(guide: PosterGuide, steps: PosterPromptStep[]): string {
  const showSections = new Set(steps.map(s => oneLine(s.section))).size > 1;
  const lines: string[] = [];
  steps.forEach((s, i) => {
    const section = oneLine(s.section);
    if (showSections && (i === 0 || oneLine(steps[i - 1].section) !== section)) lines.push(`Section: "${section}"`);
    lines.push(`${i + 1}. "${oneLine(s.title)}"`);
  });
  const goal = guide.goal?.trim() ? `\nSubtitle: "${oneLine(guide.goal)}"` : '';
  return [
    'Design a printable instructional poster, portrait, for staff at a kindergarten to follow at work.',
    '',
    `Title: "${oneLine(guide.title)}"${goal}`,
    '',
    `Steps — show all ${steps.length}, in this order, each in its own clearly numbered panel with a simple illustration of the action${showSections ? ', grouped under their section headings' : ''}:`,
    ...lines,
    '',
    'Text rules:',
    '- Use only the text in quotes above, spelled exactly as written, in its original language and characters. Do not translate, shorten, reword or add any other words.',
    '- Large, bold, very legible lettering that can be read from a few metres away; step numbers clearly visible.',
    '',
    'Style: clean, modern and friendly flat illustration; white background; soft colours with one accent colour; generous spacing and margins so nothing is cut off at the edges; no logos, brand names, watermarks or photos of real people.',
  ].join('\n');
}
