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
  if (status === 'LOST') {
    // System-tagged reasons drive the outcome directly:
    //   no_show  → visit was booked but missed
    //   cold     → never engaged (isQualified=false handles classification)
    //   not_fit  → structural mismatch (isQualified=false handles)
    // Anything else is a user-defined reason (Fee, Distance, Enrolled
    // other school, etc.) — they engaged enough to give a concrete reason,
    // so we treat it as ATTENDED for analytics purposes. Avoids the
    // awkward "Lost but Pending" rows that slipped through previously.
    const role = systemRoleFor(lostReason);
    if (role === 'no_show') return 'NO_SHOW';
    if (role === 'cold' || role === 'not_fit') return null;
    return 'ATTENDED';
  }
  // Keep attended flag as a fallback path for any other status combo we
  // might encounter (historical data, edge cases).
  if (attended) return 'ATTENDED';
  return null;
}
