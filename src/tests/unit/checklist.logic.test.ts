import { describe, it, expect } from 'vitest';
import {
  checklistLinkProblem, checklistTemplateProblem, freshChecklist, parseChecklistProgress, parseChecklistTemplate,
} from '../../services/checklist.logic.js';

describe('Onboarding checklists — items with a link button', () => {
  it('accepts web addresses and pages in the app, and refuses anything else', () => {
    expect(checklistLinkProblem('https://forms.gle/abc')).toBeNull();
    expect(checklistLinkProblem('/teachers/t1/my-career')).toBeNull();
    expect(checklistLinkProblem('javascript:alert(1)')).toMatch(/https:\/\//);
    expect(checklistLinkProblem('//evil.example')).toMatch(/https:\/\//);
    expect(checklistLinkProblem('  ')).toMatch(/Add the link/);
  });

  it('needs text on every item, and a label plus a safe link on any button', () => {
    expect(checklistTemplateProblem(['Sign contract', { task: 'EPF form', linkLabel: 'Open form', linkUrl: 'https://kwsp.gov.my' }])).toBeNull();
    expect(checklistTemplateProblem([{ task: '  ' }])).toMatch(/needs some text/);
    expect(checklistTemplateProblem([{ task: 'EPF form', linkUrl: 'https://kwsp.gov.my' }])).toMatch(/label/);
    expect(checklistTemplateProblem([{ task: 'EPF form', linkLabel: 'Open', linkUrl: 'ftp://x' }])).toMatch(/EPF form/);
  });

  it('reads old plain-text lists and new lists with links, and copies them unticked', () => {
    const items = parseChecklistTemplate(JSON.stringify(['Sign contract', { task: 'EPF form', linkLabel: 'Open form', linkUrl: 'https://kwsp.gov.my' }]));
    expect(items).toEqual([{ task: 'Sign contract' }, { task: 'EPF form', linkLabel: 'Open form', linkUrl: 'https://kwsp.gov.my' }]);
    expect(freshChecklist(items)[1]).toEqual({ task: 'EPF form', linkLabel: 'Open form', linkUrl: 'https://kwsp.gov.my', done: false });
  });

  it('keeps an item’s description, and refuses one that’s too long', () => {
    expect(parseChecklistTemplate([{ task: 'EPF form', description: ' Ask HR for the KWSP 6 form. ' }])).toEqual([{ task: 'EPF form', description: 'Ask HR for the KWSP 6 form.' }]);
    expect(checklistTemplateProblem([{ task: 'EPF form', description: 'x'.repeat(501) }])).toMatch(/description/);
    expect(freshChecklist([{ task: 'A', description: 'Why' }])).toEqual([{ task: 'A', description: 'Why', done: false }]);
  });

  it('keeps a ticked copy’s links, but drops one that isn’t safe', () => {
    expect(parseChecklistProgress([{ task: 'A', done: true, linkLabel: 'Go', linkUrl: 'https://a.example' }, { task: 'B', done: false, linkLabel: 'Go', linkUrl: 'javascript:x' }]))
      .toEqual([{ task: 'A', done: true, linkLabel: 'Go', linkUrl: 'https://a.example' }, { task: 'B', done: false }]);
  });
});
