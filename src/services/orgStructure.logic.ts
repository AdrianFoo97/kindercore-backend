// Organisational structure — reporting lines between positions. Pure rules,
// tested on their own (the page applies the same ones to its dropdowns).
//
//  - A position reports to a higher-ranked position in its own department.
//  - Its department's head reports to a position in another department — a
//    management department, once any is marked (e.g.
//    Academic's Supervisor → Management's Principal) — or nobody, at the top.
//  - A department with no head yet: its positions may report to nobody.
//  - Never in a loop.

export interface OrgPosition { positionId: string; reportsToPositionId: string | null; departmentId: string | null; titleWeight: number }
/** Each department's head position (department id → position id, or null when not set). */
export type DepartmentHeads = Map<string, string | null>;

export const isDepartmentHead = (heads: DepartmentHeads, p: Pick<OrgPosition, 'positionId' | 'departmentId'>) =>
  !!p.departmentId && heads.get(p.departmentId) === p.positionId;

/**
 * Why \`self\` can't report to \`parentId\` — or null if it can. \`self\` carries
 * its department and rank as they'll be saved (they may be changing too).
 */
export function reportingProblem(
  all: OrgPosition[], heads: DepartmentHeads, self: Pick<OrgPosition, 'positionId' | 'departmentId' | 'titleWeight'>, parentId: string | null,
  /** Departments marked as management — when any are, other departments' heads report only into them. */
  management: Set<string> = new Set(),
): string | null {
  const head = isDepartmentHead(heads, self);
  const deptHasHead = !!self.departmentId && !!heads.get(self.departmentId);
  if (parentId == null) {
    return head || !deptHasHead ? null : 'It isn’t its department’s head, so it reports to a position in its own department.';
  }
  if (parentId === self.positionId) return 'A position can’t report to itself.';
  const parent = all.find(p => p.positionId === parentId);
  if (!parent) return 'That position no longer exists — pick again.';
  if (head && parent.departmentId === self.departmentId) return 'A department’s head reports to a position in another department.';
  // Once departments are marked as management, heads report only into them.
  if (head && management.size > 0 && !management.has(parent.departmentId ?? '')) return 'A department’s head reports to a position in a management department.';
  if (!head && parent.departmentId !== self.departmentId) return 'It reports within its own department — only the department’s head reports outside it.';
  if (!head && parent.titleWeight <= self.titleWeight) return 'It can only report to a higher-ranked position.';
  // Walk up from the new parent: reaching this position means it would report to its own report.
  const byId = new Map(all.map(p => [p.positionId, p.reportsToPositionId]));
  const seen = new Set<string>();
  for (let at: string | null | undefined = parentId; at; at = byId.get(at)) {
    if (at === self.positionId) return 'That would make a loop — the position it reports to already reports to it.';
    if (seen.has(at)) break;
    seen.add(at);
  }
  return null;
}

// ── Career path ──────────────────────────────────────────────────────────────
// Reporting line ("who manages me") and career path ("what do I grow into")
// differ: Assistant, Junior and Senior EI all report to the Supervisor, yet
// each is a step up. So a career path climbs its own department by rank up to
// the department's head, then follows the head's "reports to" line upwards
// (Supervisor → Shadow Principal → Principal). Only positions on the career
// path count; each department gets its own path.

export interface CareerPosition extends OrgPosition { inCareerProgression: boolean }

/** The career path a position belongs to, lowest step first. */
export function careerLadder<P extends CareerPosition>(all: P[], heads: DepartmentHeads, positionId: string): P[] {
  const self = all.find(p => p.positionId === positionId);
  if (!self) return [];
  // 1. Its department, by rank, up to (and including) the head — or the top, with no head set.
  const inDept = all.filter(p => p.departmentId === self.departmentId && p.inCareerProgression).sort((a, b) => a.titleWeight - b.titleWeight);
  const head = self.departmentId ? all.find(p => p.positionId === heads.get(self.departmentId!)) : undefined;
  const steps = head ? inDept.filter(p => p.titleWeight <= head.titleWeight) : inDept;
  // 2. Above the head: its reporting line, upwards (on-path positions only; stop on a loop).
  const top = head ?? steps[steps.length - 1];
  const seen = new Set(steps.map(p => p.positionId));
  for (let at = top ? all.find(p => p.positionId === top.reportsToPositionId) : undefined; at && !seen.has(at.positionId);
    at = all.find(p => p.positionId === at!.reportsToPositionId)) {
    seen.add(at.positionId);
    if (at.inCareerProgression) steps.push(at);
  }
  return steps;
}

/** The next step up from a position on its path (null at the top). Off the path: the first step above its rank. */
export function nextOnLadder<P extends CareerPosition>(ladder: P[], current: P): P | null {
  const i = ladder.findIndex(p => p.positionId === current.positionId);
  if (i >= 0) return ladder[i + 1] ?? null;
  return ladder.find(p => p.titleWeight > current.titleWeight) ?? null;
}

/** Each department's first steps (the entry tiers) — e.g. for a fair leaderboard. */
export function entryTiers<P extends CareerPosition>(all: P[], tiers: number): Set<string> {
  const byDept = new Map<string, P[]>();
  for (const p of all.filter(x => x.inCareerProgression)) {
    const k = p.departmentId ?? '';
    byDept.set(k, [...(byDept.get(k) ?? []), p]);
  }
  const ids = new Set<string>();
  for (const list of byDept.values()) for (const p of list.sort((a, b) => a.titleWeight - b.titleWeight).slice(0, tiers)) ids.add(p.positionId);
  return ids;
}

// ── A person's "Reports to" (staff records) ─────────────────────────────────
// Everyone reports to someone higher-ranked in their own department, or to
// anyone in a Management department. Only Management staff may report to
// nobody (the top of the organisation).

export interface RankedPosition { positionId: string; departmentId: string | null; titleWeight: number; reportsToPositionId?: string | null; name?: string }

/** Why this person can't report to that manager (null = nobody) — or null when they can. */
export function personReportsToProblem(
  selfPositionId: string | null, managerPositionId: string | null | undefined, managerChosen: boolean,
  positions: RankedPosition[], management: Set<string>,
): string | null {
  const self = positions.find(p => p.positionId === selfPositionId) ?? null;
  const selfInManagement = !!self?.departmentId && management.has(self.departmentId);
  if (!managerChosen) return selfInManagement ? null : 'Pick who they report to — only Management staff can report to nobody.';
  const mgr = positions.find(p => p.positionId === managerPositionId) ?? null;
  // Their position's reporting line (Settings → Positions) decides: anyone in a position above it in that line.
  const line = positionsAbove(selfPositionId, positions);
  if (line.length) {
    if (mgr && line.some(p => p.positionId === mgr.positionId)) return null;
    return `They report to someone in a position above theirs: ${line.map(p => p.name ?? p.positionId).join(', ')}.`;
  }
  // No line set for their position yet: someone higher in their own department, or anyone in Management.
  if (mgr?.departmentId && management.has(mgr.departmentId)) return null;
  if (self && mgr && self.departmentId && mgr.departmentId === self.departmentId && mgr.titleWeight > self.titleWeight) return null;
  return 'They can report to someone higher-ranked in their own department, or anyone in Management.';
}

/** The positions above this one in its reporting line, nearest first (Junior EI → Supervisor → … → Principal). Stops on a loop. */
export function positionsAbove<P extends RankedPosition>(positionId: string | null, positions: P[]): P[] {
  const out: P[] = [];
  const seen = new Set<string>(positionId ? [positionId] : []);
  let next = positions.find(p => p.positionId === positionId)?.reportsToPositionId ?? null;
  while (next && !seen.has(next)) {
    seen.add(next);
    const p = positions.find(x => x.positionId === next);
    if (!p) break;
    out.push(p);
    next = p.reportsToPositionId ?? null;
  }
  return out;
}
