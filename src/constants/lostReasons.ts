// Lost-reason strings that participate in the Lead Quality / Appointment Rate
// KPI classifier. These are pinned in the settings UI as SYSTEM reasons —
// users can't delete them — because the classifier's case handling would
// break silently otherwise.
//
// Three roles:
//   • no_show — the lead had an appointment but didn't show up. Still counts
//     as QUALIFIED (they demonstrated intent; execution broke).
//   • cold    — the lead never engaged (no reply, didn't want to come).
//     Counts as UNQUALIFIED — marketing didn't convert them.
//   • not_fit — a structural mismatch between the lead and what the school
//     can offer (e.g. special-needs support we don't provide). Counts as
//     UNQUALIFIED — the lead was never a viable prospect, regardless of
//     how well marketing or sales performed.
//
// Any other lost reason (e.g. "Fee too expensive", "Enrolled other school")
// is user-managed and defaults to QUALIFIED — the lead was real, the school
// just didn't win them.

export type SystemLostReasonRole = 'no_show' | 'cold' | 'not_fit';

export interface SystemLostReason {
  label: string;
  role: SystemLostReasonRole;
}

export const SYSTEM_LOST_REASONS: readonly SystemLostReason[] = [
  { label: 'Missed appointment',                  role: 'no_show' },
  { label: 'No response or declined appointment', role: 'cold'    },
  { label: 'Special Need',                        role: 'not_fit' },
];

export const SYSTEM_LOST_REASON_LABELS = SYSTEM_LOST_REASONS.map(r => r.label);

export function systemRoleFor(label: string | null | undefined): SystemLostReasonRole | null {
  if (!label) return null;
  const hit = SYSTEM_LOST_REASONS.find(r => r.label === label);
  return hit?.role ?? null;
}

// ── Derived analytics columns ───────────────────────────────────────────────
// Every Lead write path must route through these helpers so the two
// analytics columns (isQualified, visitOutcome) stay consistent with the
// status + lostReason + attended combination. Centralising the rules here
// means the classifier downstream is a pure read — zero inference.

export type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'APPOINTMENT_BOOKED' | 'FOLLOW_UP'
  | 'ENROLLED' | 'LOST' | 'REJECTED';

export function deriveIsQualified(status: LeadStatus | string, lostReason: string | null | undefined): boolean {
  if (status === 'REJECTED') return false;
  if (status === 'LOST') {
    const role = systemRoleFor(lostReason);
    if (role === 'cold' || role === 'not_fit') return false;
  }
  return true;
}

export type VisitOutcome = 'ATTENDED' | 'NO_SHOW' | null;

export function deriveVisitOutcome(
  status: LeadStatus | string,
  attended: boolean,
  lostReason: string | null | undefined,
): VisitOutcome {
  if (status === 'FOLLOW_UP' || status === 'ENROLLED') return 'ATTENDED';
  if (status === 'LOST' && attended) return 'ATTENDED';
  // Explicit no-show: user marked the lead LOST with the system "no_show"
  // reason. Storing NO_SHOW directly means the classifier doesn't need to
  // infer from time for these rows.
  if (status === 'LOST' && systemRoleFor(lostReason) === 'no_show') return 'NO_SHOW';
  return null;
}
