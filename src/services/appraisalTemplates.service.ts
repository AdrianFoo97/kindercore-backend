import { randomUUID } from 'crypto';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalSections, appraisalStagePositions, appraisalStages, appraisalTemplates, positions,
} from '../db/schema.js';
import { checkStages, checkTemplate, type InputType, type MissingPolicy, type StageKind } from './appraisalScoring.service.js';

// Appraisal templates (Settings → HR & Payroll → Appraisal templates).
// A template family is one appraisal form over time: at most one ACTIVE
// version (used for new appraisals) and at most one DRAFT (being edited).
// Live versions are never edited in place — "Edit" copies them into a new
// draft, so finished appraisals keep the exact version they were scored on.
// Which positions use a form is set per family, so it carries across versions.

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type Scope = 'ANYONE' | 'OWN_TEAM';

export interface CriterionInput {
  name: string;
  description: string | null;
  weight: number;
  inputType: InputType;
  scaleConfig: Record<string, unknown> | null;
  /** Optional points it's judged on — scored on its scale and averaged. Empty = scored directly. */
  points: { name: string }[];
}
export interface SectionInput { name: string; weight: number; criteria: CriterionInput[] }
export interface StageInput { name: string; kind: StageKind; scope: Scope; positionIds: string[] }
export interface TemplateInput {
  name: string;
  description: string | null;
  frequency: Frequency;
  missingPolicy: MissingPolicy;
  sections: SectionInput[];
  stages: StageInput[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** The usual chain for a new form: assessed by their manager, signed off, acknowledged. */
export const STARTER_STAGES: StageInput[] = [
  { name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: [] },
  { name: 'Signed off by', kind: 'SIGN_OFF', scope: 'ANYONE', positionIds: [] },
  { name: 'Acknowledged by the staff member', kind: 'ACKNOWLEDGE', scope: 'ANYONE', positionIds: [] },
];

// ── Reading ──────────────────────────────────────────────────────────────────

async function stagesOf(exec: Exec, templateId: string) {
  const stages = await exec.select().from(appraisalStages).where(eq(appraisalStages.templateId, templateId)).orderBy(asc(appraisalStages.sortOrder));
  const links = stages.length
    ? await exec.select().from(appraisalStagePositions).where(inArray(appraisalStagePositions.stageId, stages.map(s => s.id)))
    : [];
  return stages.map(s => ({
    id: s.id, name: s.name, kind: s.kind, scope: s.scope,
    positionIds: links.filter(l => l.stageId === s.id).map(l => l.positionId),
  }));
}

async function sectionsOf(exec: Exec, templateId: string) {
  const sections = await exec.select().from(appraisalSections).where(eq(appraisalSections.templateId, templateId)).orderBy(asc(appraisalSections.sortOrder));
  const criteria = sections.length
    ? await exec.select().from(appraisalCriteria).where(inArray(appraisalCriteria.sectionId, sections.map(s => s.id))).orderBy(asc(appraisalCriteria.sortOrder))
    : [];
  const points = criteria.length
    ? await exec.select().from(appraisalCriterionPoints).where(inArray(appraisalCriterionPoints.criterionId, criteria.map(c => c.id))).orderBy(asc(appraisalCriterionPoints.sortOrder))
    : [];
  return sections.map(s => ({
    id: s.id, name: s.name, weight: s.weight,
    criteria: criteria.filter(c => c.sectionId === s.id).map(c => ({
      id: c.id, name: c.name, description: c.description, weight: c.weight,
      inputType: c.inputType, scaleConfig: (c.scaleConfig ?? null) as Record<string, unknown> | null, metricSource: c.metricSource,
      points: points.filter(p => p.criterionId === c.id).map(p => ({ id: p.id, name: p.name })),
    })),
  }));
}

async function familyPositionIds(exec: Exec, familyId: string): Promise<string[]> {
  const rows = await exec.select({ positionId: appraisalAssignments.positionId }).from(appraisalAssignments)
    .where(and(eq(appraisalAssignments.templateFamilyId, familyId), isNotNull(appraisalAssignments.positionId)));
  return rows.map(r => r.positionId!);
}

/** Everything that stops a template going live, in plain words. */
export function templateProblems(t: { missingPolicy: MissingPolicy; sections: Awaited<ReturnType<typeof sectionsOf>>; stages: Awaited<ReturnType<typeof stagesOf>> }): string[] {
  return [...checkTemplate(t), ...checkStages(t.stages)];
}

/** One template version in full, with what stops it going live and its family's other versions. */
export async function loadTemplate(id: string, exec: Exec = db) {
  const [t] = await exec.select().from(appraisalTemplates).where(eq(appraisalTemplates.id, id));
  if (!t || t.isLegacy) return null;
  const [sections, stages, positionIds, family] = await Promise.all([
    sectionsOf(exec, id), stagesOf(exec, id), familyPositionIds(exec, t.familyId),
    exec.select({ id: appraisalTemplates.id, status: appraisalTemplates.status, version: appraisalTemplates.version })
      .from(appraisalTemplates).where(eq(appraisalTemplates.familyId, t.familyId)),
  ]);
  return {
    id: t.id, familyId: t.familyId, name: t.name, description: t.description, frequency: t.frequency,
    status: t.status, version: t.version, missingPolicy: t.missingPolicy, updatedAt: t.updatedAt,
    sections, stages, positionIds,
    problems: templateProblems({ missingPolicy: t.missingPolicy, sections, stages }),
    draftId: family.find(v => v.status === 'DRAFT' && v.id !== t.id)?.id ?? null,
    activeId: family.find(v => v.status === 'ACTIVE' && v.id !== t.id)?.id ?? null,
  };
}
export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof loadTemplate>>>;

const STATUS_ORDER = { ACTIVE: 0, DRAFT: 1, RETIRED: 2 } as const;

/** One row per form: its live version (else its draft, else its latest), with counts and positions. */
export async function listTemplateFamilies() {
  const all = await db.select().from(appraisalTemplates).where(eq(appraisalTemplates.isLegacy, false));
  const byFamily = new Map<string, typeof all>();
  for (const t of all) byFamily.set(t.familyId, [...(byFamily.get(t.familyId) ?? []), t]);

  const current = [...byFamily.values()].map(vs =>
    vs.find(v => v.status === 'ACTIVE') ?? vs.find(v => v.status === 'DRAFT') ?? [...vs].sort((a, b) => b.version - a.version)[0]);
  const ids = current.map(c => c.id);
  const sections = ids.length ? await db.select({ id: appraisalSections.id, templateId: appraisalSections.templateId }).from(appraisalSections).where(inArray(appraisalSections.templateId, ids)) : [];
  const criteria = sections.length ? await db.select({ sectionId: appraisalCriteria.sectionId }).from(appraisalCriteria).where(inArray(appraisalCriteria.sectionId, sections.map(s => s.id))) : [];
  const assignments = await db.select().from(appraisalAssignments).where(isNotNull(appraisalAssignments.positionId));

  return current.map(c => {
    const sectionIds = new Set(sections.filter(s => s.templateId === c.id).map(s => s.id));
    const draft = byFamily.get(c.familyId)!.find(v => v.status === 'DRAFT');
    return {
      id: c.id, familyId: c.familyId, name: c.name, description: c.description, frequency: c.frequency,
      status: c.status, version: c.version, updatedAt: c.updatedAt,
      draftId: draft && draft.id !== c.id ? draft.id : null,
      sectionCount: sectionIds.size,
      criterionCount: criteria.filter(x => sectionIds.has(x.sectionId)).length,
      positionIds: assignments.filter(a => a.templateFamilyId === c.familyId).map(a => a.positionId!),
    };
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Positions in the input that don't exist (so nothing points at a deleted position). */
export async function unknownPositionIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await db.select({ id: positions.positionId }).from(positions).where(inArray(positions.positionId, unique));
  const known = new Set(found.map(f => f.id));
  return unique.filter(id => !known.has(id));
}

/** Replace a draft's sections, criteria and steps with the input's. */
async function writeContents(tx: Tx, templateId: string, input: Pick<TemplateInput, 'sections' | 'stages'>) {
  const oldSections = await tx.select({ id: appraisalSections.id }).from(appraisalSections).where(eq(appraisalSections.templateId, templateId));
  if (oldSections.length) {
    const oldCriteria = await tx.select({ id: appraisalCriteria.id }).from(appraisalCriteria).where(inArray(appraisalCriteria.sectionId, oldSections.map(s => s.id)));
    if (oldCriteria.length) await tx.delete(appraisalCriterionPoints).where(inArray(appraisalCriterionPoints.criterionId, oldCriteria.map(c => c.id)));
    await tx.delete(appraisalCriteria).where(inArray(appraisalCriteria.sectionId, oldSections.map(s => s.id)));
  }
  await tx.delete(appraisalSections).where(eq(appraisalSections.templateId, templateId));
  const oldStages = await tx.select({ id: appraisalStages.id }).from(appraisalStages).where(eq(appraisalStages.templateId, templateId));
  if (oldStages.length) await tx.delete(appraisalStagePositions).where(inArray(appraisalStagePositions.stageId, oldStages.map(s => s.id)));
  await tx.delete(appraisalStages).where(eq(appraisalStages.templateId, templateId));

  for (const [i, s] of input.sections.entries()) {
    const sectionId = randomUUID();
    await tx.insert(appraisalSections).values({ id: sectionId, templateId, name: s.name, weight: s.weight, sortOrder: i });
    for (const [j, c] of s.criteria.entries()) {
      const criterionId = randomUUID();
      await tx.insert(appraisalCriteria).values({
        id: criterionId, sectionId, name: c.name, description: c.description, weight: c.weight,
        inputType: c.inputType, scaleConfig: c.scaleConfig, metricSource: null, sortOrder: j,
      });
      if (c.points.length) {
        await tx.insert(appraisalCriterionPoints).values(c.points.map((p, k) => ({ id: randomUUID(), criterionId, name: p.name, sortOrder: k })));
      }
    }
  }
  for (const [i, st] of input.stages.entries()) {
    const stageId = randomUUID();
    await tx.insert(appraisalStages).values({ id: stageId, templateId, name: st.name, kind: st.kind, scope: st.scope, sortOrder: i });
    // Acknowledging is always the staff member themselves — no positions.
    const positionIds = st.kind === 'ACKNOWLEDGE' ? [] : [...new Set(st.positionIds)];
    if (positionIds.length) {
      await tx.insert(appraisalStagePositions).values(positionIds.map(positionId => ({ id: randomUUID(), stageId, positionId })));
    }
  }
}

/** A new form, as version 1 draft. */
export async function createTemplate(input: TemplateInput): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.transaction(async tx => {
    await tx.insert(appraisalTemplates).values({
      id, familyId: id, name: input.name, description: input.description, frequency: input.frequency,
      missingPolicy: input.missingPolicy, status: 'DRAFT', version: 1, isLegacy: false, createdAt: now, updatedAt: now,
    });
    await writeContents(tx, id, input);
  });
  return id;
}

type WriteResult = 'ok' | 'not-found' | 'not-draft';

async function lockTemplate(tx: Tx, id: string) {
  const [t] = await tx.select().from(appraisalTemplates).where(eq(appraisalTemplates.id, id)).for('update');
  return t && !t.isLegacy ? t : null;
}

/** Save a draft's whole content. Live and retired versions can't be changed. */
export async function saveDraft(id: string, input: TemplateInput): Promise<WriteResult> {
  return db.transaction(async tx => {
    const t = await lockTemplate(tx, id);
    if (!t) return 'not-found';
    if (t.status !== 'DRAFT') return 'not-draft';
    await tx.update(appraisalTemplates).set({
      name: input.name, description: input.description, frequency: input.frequency,
      missingPolicy: input.missingPolicy, updatedAt: new Date(),
    }).where(eq(appraisalTemplates.id, id));
    await writeContents(tx, id, input);
    return 'ok';
  });
}

/** The draft to edit for this form: its existing draft, or a new one copied from this version. */
export async function startNewVersion(id: string): Promise<string | null> {
  return db.transaction(async tx => {
    const t = await lockTemplate(tx, id);
    if (!t) return null;
    if (t.status === 'DRAFT') return t.id;
    const family = await tx.select().from(appraisalTemplates).where(eq(appraisalTemplates.familyId, t.familyId));
    const existing = family.find(v => v.status === 'DRAFT');
    if (existing) return existing.id;

    const [sections, stages] = await Promise.all([sectionsOf(tx, id), stagesOf(tx, id)]);
    const draftId = randomUUID();
    const now = new Date();
    await tx.insert(appraisalTemplates).values({
      id: draftId, familyId: t.familyId, name: t.name, description: t.description, frequency: t.frequency,
      missingPolicy: t.missingPolicy, status: 'DRAFT', version: Math.max(...family.map(v => v.version)) + 1,
      isLegacy: false, createdAt: now, updatedAt: now,
    });
    await writeContents(tx, draftId, { sections, stages });
    return draftId;
  });
}

/** Put a draft live (if nothing is wrong with it); the form's previous live version retires. */
export async function activateTemplate(id: string): Promise<WriteResult | { problems: string[] }> {
  return db.transaction(async tx => {
    const t = await lockTemplate(tx, id);
    if (!t) return 'not-found';
    if (t.status !== 'DRAFT') return 'not-draft';
    const [sections, stages] = await Promise.all([sectionsOf(tx, id), stagesOf(tx, id)]);
    const problems = templateProblems({ missingPolicy: t.missingPolicy, sections, stages });
    if (problems.length) return { problems };
    const now = new Date();
    await tx.update(appraisalTemplates).set({ status: 'RETIRED', updatedAt: now })
      .where(and(eq(appraisalTemplates.familyId, t.familyId), eq(appraisalTemplates.status, 'ACTIVE')));
    await tx.update(appraisalTemplates).set({ status: 'ACTIVE', updatedAt: now }).where(eq(appraisalTemplates.id, id));
    return 'ok';
  });
}

/** Stop using a live form for new appraisals (finished ones keep it). */
export async function retireTemplate(id: string): Promise<WriteResult> {
  return db.transaction(async tx => {
    const t = await lockTemplate(tx, id);
    if (!t) return 'not-found';
    if (t.status !== 'ACTIVE') return 'not-draft';
    await tx.update(appraisalTemplates).set({ status: 'RETIRED', updatedAt: new Date() }).where(eq(appraisalTemplates.id, id));
    return 'ok';
  });
}

/** Throw away a draft. A form that was only ever this draft also loses its positions. */
export async function deleteDraft(id: string): Promise<WriteResult> {
  return db.transaction(async tx => {
    const t = await lockTemplate(tx, id);
    if (!t) return 'not-found';
    if (t.status !== 'DRAFT') return 'not-draft';
    await writeContents(tx, id, { sections: [], stages: [] });
    await tx.delete(appraisalTemplates).where(eq(appraisalTemplates.id, id));
    const [other] = await tx.select({ id: appraisalTemplates.id }).from(appraisalTemplates).where(eq(appraisalTemplates.familyId, t.familyId));
    if (!other) await tx.delete(appraisalAssignments).where(eq(appraisalAssignments.templateFamilyId, t.familyId));
    return 'ok';
  });
}

/**
 * Which positions use this form. A position can use only one form at a time:
 * if another form still in use (live or draft) has it, nothing changes and
 * that form's name comes back. Leftovers on fully retired forms are moved.
 */
export async function setFamilyPositions(familyId: string, positionIds: string[]): Promise<'not-found' | { taken: { positionId: string; templateName: string }[] } | 'ok'> {
  const wanted = [...new Set(positionIds)];
  return db.transaction(async tx => {
    const family = await tx.select().from(appraisalTemplates).where(and(eq(appraisalTemplates.familyId, familyId), eq(appraisalTemplates.isLegacy, false)));
    if (!family.length) return 'not-found';
    const elsewhere = wanted.length
      ? await tx.select().from(appraisalAssignments).where(and(inArray(appraisalAssignments.positionId, wanted), ne(appraisalAssignments.templateFamilyId, familyId)))
      : [];
    const otherFamilies = elsewhere.length
      ? await tx.select().from(appraisalTemplates).where(inArray(appraisalTemplates.familyId, [...new Set(elsewhere.map(e => e.templateFamilyId))]))
      : [];
    const inUse = (fid: string) => otherFamilies.some(t => t.familyId === fid && t.status !== 'RETIRED');
    const nameOf = (fid: string) => {
      const vs = otherFamilies.filter(t => t.familyId === fid);
      return (vs.find(v => v.status === 'ACTIVE') ?? vs.find(v => v.status === 'DRAFT') ?? vs[0])?.name ?? 'another form';
    };
    const taken = elsewhere.filter(e => inUse(e.templateFamilyId)).map(e => ({ positionId: e.positionId!, templateName: nameOf(e.templateFamilyId) }));
    if (taken.length) return { taken };

    const stale = elsewhere.map(e => e.id);
    if (stale.length) await tx.delete(appraisalAssignments).where(inArray(appraisalAssignments.id, stale));
    await tx.delete(appraisalAssignments).where(and(eq(appraisalAssignments.templateFamilyId, familyId), isNotNull(appraisalAssignments.positionId)));
    if (wanted.length) {
      const now = new Date();
      await tx.insert(appraisalAssignments).values(wanted.map(positionId => ({ id: randomUUID(), templateFamilyId: familyId, positionId, teacherId: null, createdAt: now })));
    }
    return 'ok';
  });
}
