import type { SectionKind, StatementDraft } from './pnlReading/index.js';

// P&L import — the pure part: checking a reading against the PDF's own text,
// matching line names to Operating Cost categories, and working out what an
// import writes and what it leaves out. No database, no AI: unit-tested.

/** Differences under half a sen are rounding, not a mismatch. */
export const AMOUNT_TOLERANCE = 0.005;
/** A name this close to a category (edits) is suggested — never matched silently. */
export const SUGGEST_MAX_EDITS = 2;
/** …and names this short are too ambiguous to suggest by spelling. */
export const SUGGEST_MIN_LENGTH = 5;
/** Lines that are already in payroll — skipped unless someone changes the rule. */
export const DEFAULT_SKIP_LINES = ['Salaries', 'PCB', 'Director Remuneration', 'Income Tax'];

/** Only these sections hold costs; revenue and other income are never imported. */
const COST_KINDS: SectionKind[] = ['COST_OF_SALES', 'EXPENSE'];
export const isCostSection = (kind: SectionKind) => COST_KINDS.includes(kind);

/** "Water  & Electricity" → "water and electricity": case, spacing and "&" don't matter. */
export function normaliseLineName(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Every amount printed in the PDF's text, as "1116.56" (no sign, no commas). */
export function amountsInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d{2})|\d+\.\d{2}/g)) {
    out.add(Number(m[0].replace(/,/g, '')).toFixed(2));
  }
  return out;
}

export interface SectionCheck {
  /** The lines' total. */
  sum: number;
  printedSubtotal: number | null;
  /** null when no subtotal is printed to compare with. */
  addsUp: boolean | null;
}

export interface ReadingCheck {
  /** False for a scanned PDF (no text to check against) — every line then needs checking by eye. */
  hasText: boolean;
  sections: (SectionCheck & { linesFound: boolean[] })[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Proves the reading against the PDF itself: each amount is printed in it, each section adds up. */
export function checkReading(draft: StatementDraft, pdfText: string): ReadingCheck {
  const printed = amountsInText(pdfText);
  const hasText = printed.size > 0;
  return {
    hasText,
    sections: draft.sections.map(s => {
      const sum = round2(s.lines.reduce((t, l) => t + l.amount, 0));
      return {
        sum,
        printedSubtotal: s.printedSubtotal,
        addsUp: s.printedSubtotal === null ? null : Math.abs(sum - s.printedSubtotal) < AMOUNT_TOLERANCE,
        linesFound: s.lines.map(l => hasText && printed.has(Math.abs(l.amount).toFixed(2))),
      };
    }),
  };
}

/**
 * A reading passes when every cost amount is printed in the PDF and every
 * cost section adds up. A scanned PDF can't be checked, so it isn't counted
 * as failing (a backup reader couldn't prove anything either).
 */
export function readingPasses(draft: StatementDraft, check: ReadingCheck): boolean {
  if (!check.hasText) return true;
  return draft.sections.every((s, i) => !isCostSection(s.kind)
    || (check.sections[i].addsUp !== false && check.sections[i].linesFound.every(Boolean)));
}

/** Levenshtein distance, stopping early once it's past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface CategoryRef { id: string; name: string; groupId: string; groupName: string }
export interface ImportRule { lineKey: string; action: 'RECORD' | 'SKIP'; categoryId: string | null }

/**
 * - MATCHED: same name as one category, or a remembered "record into" rule
 * - SUGGESTED: a close spelling, or two categories share the name — confirm it
 * - NEW: nothing matches — record somewhere, or skip
 * - SKIP_RULE: a remembered (or default) "always skip"
 * - NOT_A_COST: revenue / other income — never imported
 * - ZERO: nothing spent this month
 * - NEGATIVE: a credit in a cost section — enter it by hand
 */
export type LineStatus = 'MATCHED' | 'SUGGESTED' | 'NEW' | 'SKIP_RULE' | 'NOT_A_COST' | 'ZERO' | 'NEGATIVE';

export interface LineMatch { status: LineStatus; categoryId: string | null }

/** How one cost line relates to the categories and rules (amount aside). */
export function matchLine(name: string, categories: CategoryRef[], rules: Map<string, ImportRule>): LineMatch {
  const key = normaliseLineName(name);
  const rule = rules.get(key);
  if (rule?.action === 'SKIP') return { status: 'SKIP_RULE', categoryId: null };
  if (rule?.action === 'RECORD' && rule.categoryId && categories.some(c => c.id === rule.categoryId)) {
    return { status: 'MATCHED', categoryId: rule.categoryId };
  }
  const same = categories.filter(c => normaliseLineName(c.name) === key);
  if (same.length === 1) return { status: 'MATCHED', categoryId: same[0].id };
  if (same.length > 1) return { status: 'SUGGESTED', categoryId: same[0].id };
  if (key.length >= SUGGEST_MIN_LENGTH) {
    let best: { id: string; d: number } | null = null;
    for (const c of categories) {
      const d = editDistance(key, normaliseLineName(c.name), SUGGEST_MAX_EDITS);
      if (d <= SUGGEST_MAX_EDITS && (!best || d < best.d)) best = { id: c.id, d };
    }
    if (best) return { status: 'SUGGESTED', categoryId: best.id };
  }
  return { status: 'NEW', categoryId: null };
}

export interface PreviewLine {
  /** "section index-line index", unique within the preview. */
  key: string;
  section: string;
  sectionKind: SectionKind;
  name: string;
  amount: number;
  /** The amount was found printed in the PDF. */
  found: boolean;
  /** What the PDF's own text says for this line, when it differs from the AI's reading (else null). */
  textAmount: number | null;
  status: LineStatus;
  /** Matched or suggested category. */
  categoryId: string | null;
}

/** Every line of the reading with its status — what the preview screen shows. */
export function previewLines(draft: StatementDraft, check: ReadingCheck, categories: CategoryRef[], rules: Map<string, ImportRule>): PreviewLine[] {
  return draft.sections.flatMap((s, si) => s.lines.map((l, li): PreviewLine => {
    const base = { key: `${si}-${li}`, section: s.title, sectionKind: s.kind, name: l.name, amount: l.amount, found: check.sections[si].linesFound[li], textAmount: null };
    if (!isCostSection(s.kind)) return { ...base, status: 'NOT_A_COST', categoryId: null };
    if (Math.abs(l.amount) < AMOUNT_TOLERANCE) return { ...base, status: 'ZERO', categoryId: null };
    if (l.amount < 0) return { ...base, status: 'NEGATIVE', categoryId: null };
    return { ...base, ...matchLine(l.name, categories, rules) };
  }));
}

// ── Applying an import ────────────────────────────────────────────────────────

/** What the person decided for one cost line. */
export interface LineDecision {
  name: string;
  section: string;
  amount: number;
  /** RECORD into `categoryId` (an existing one, or the id given to a new one), or SKIP. */
  action: 'RECORD' | 'SKIP';
  categoryId: string | null;
  /** Skipped because of a rule (not by hand) — only changes the reason shown. */
  byRule?: boolean;
  /** Overwrite a different amount already entered for that month. */
  replace?: boolean;
  /** Save this choice as a rule for next time. */
  remember?: boolean;
}

export interface NotImported { name: string; section: string; amount: number; reason: string }

export interface ImportPlan {
  /** Amount per category to write (lines into the same category are added together). */
  writes: { categoryId: string; amount: number }[];
  notImported: NotImported[];
  rules: { lineKey: string; lineName: string; action: 'RECORD' | 'SKIP'; categoryId: string | null }[];
}

const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Works out what an import writes, given each decision and the amounts
 * already entered for that month. An existing different amount is kept
 * unless that line says replace — and then it's listed as not imported.
 */
export function planImport(decisions: LineDecision[], existing: Map<string, number>): ImportPlan {
  const wanted = new Map<string, { amount: number; lines: LineDecision[] }>();
  const notImported: NotImported[] = [];
  const rules: ImportPlan['rules'] = [];

  for (const d of decisions) {
    if (d.remember) rules.push({ lineKey: normaliseLineName(d.name), lineName: d.name, action: d.action, categoryId: d.action === 'RECORD' ? d.categoryId : null });
    if (d.action === 'SKIP' || !d.categoryId) {
      notImported.push({ name: d.name, section: d.section, amount: d.amount, reason: d.byRule ? 'Skipped by an import rule' : 'Skipped' });
      continue;
    }
    const w = wanted.get(d.categoryId) ?? { amount: 0, lines: [] };
    w.amount = round2(w.amount + d.amount);
    w.lines.push(d);
    wanted.set(d.categoryId, w);
  }

  const writes: ImportPlan['writes'] = [];
  for (const [categoryId, w] of wanted) {
    const before = existing.get(categoryId);
    const differs = before !== undefined && Math.abs(before - w.amount) >= AMOUNT_TOLERANCE;
    if (differs && !w.lines.some(l => l.replace)) {
      for (const l of w.lines) {
        notImported.push({ name: l.name, section: l.section, amount: l.amount, reason: `Kept the ${money(before)} already entered` });
      }
      continue;
    }
    writes.push({ categoryId, amount: w.amount });
  }
  return { writes, notImported, rules };
}

// ── Comparing providers (test site) ──────────────────────────────────────────

/** A reading's total of everything in cost sections. */
export function costTotal(draft: StatementDraft): number {
  return round2(draft.sections.filter(s => isCostSection(s.kind)).flatMap(s => s.lines).reduce((t, l) => t + l.amount, 0));
}

export interface ReadingDifference {
  name: string;
  /** Each reader's amount for this line (null = that reader didn't find the line). */
  amounts: Record<string, number | null>;
}

/** The cost lines readers disagree on — a different amount, or a line only some of them found. */
export function readingDifferences(readings: { reader: string; draft: StatementDraft }[]): ReadingDifference[] {
  const byLine = new Map<string, { name: string; amounts: Record<string, number> }>();
  for (const { reader, draft } of readings) {
    for (const s of draft.sections) {
      if (!isCostSection(s.kind)) continue;
      for (const l of s.lines) {
        const key = normaliseLineName(l.name);
        const row = byLine.get(key) ?? { name: l.name, amounts: {} };
        row.amounts[reader] = round2((row.amounts[reader] ?? 0) + l.amount);
        byLine.set(key, row);
      }
    }
  }
  const readers = readings.map(r => r.reader);
  return [...byLine.values()]
    .map(r => ({ name: r.name, amounts: Object.fromEntries(readers.map(id => [id, r.amounts[id] ?? null])) }))
    .filter(r => {
      const values = Object.values(r.amounts);
      return values.some(v => v === null) || values.some(v => Math.abs((v ?? 0) - (values[0] ?? 0)) >= AMOUNT_TOLERANCE);
    });
}

// ── Defences against a tampered reading (prompt injection) ───────────────────

/** Phrases written to steer an AI ("ignore previous instructions…") — never part of a real P&L. */
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?|the above)\b/i,
  /\b(system|developer)\s+prompt\b/i,
  /\byou\s+are\s+(an?\s+|the\s+)?(ai|assistant|language model|llm|chatbot)\b/i,
  /\b(as an ai|ai assistant|assistant:|<\/?(instructions?|system)>)/i,
  /\b(report|set|change|change the)\b[^.\n]{0,40}\bas\b[^.\n]{0,20}\d[\d,]*\.\d{2}\b[^.\n]{0,30}\b(instead|every|all)\b/i,
];

/** True when the PDF's text contains wording aimed at an AI rather than a reader. */
export function looksLikeInjection(pdfText: string): boolean {
  return INSTRUCTION_PATTERNS.some(p => p.test(pdfText));
}

/**
 * Lines where the AI's amount differs from what the PDF's own text says for
 * the same line (read without AI). Every amount being printed somewhere isn't
 * enough: a tampered reading can move printed amounts between lines. Returns
 * "section index-line index" → the amount the text shows.
 */
export function textDisagreements(aiDraft: StatementDraft, textDraft: StatementDraft): Map<string, number> {
  const fromText = new Map<string, number>();
  for (const s of textDraft.sections) {
    if (!isCostSection(s.kind)) continue;
    for (const l of s.lines) {
      const key = normaliseLineName(l.name);
      fromText.set(key, round2((fromText.get(key) ?? 0) + l.amount));
    }
  }
  const out = new Map<string, number>();
  aiDraft.sections.forEach((s, si) => {
    if (!isCostSection(s.kind)) return;
    s.lines.forEach((l, li) => {
      const printed = fromText.get(normaliseLineName(l.name));
      if (printed !== undefined && Math.abs(printed - l.amount) >= AMOUNT_TOLERANCE) out.set(`${si}-${li}`, printed);
    });
  });
  return out;
}
