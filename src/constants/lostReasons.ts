// Lost-reason strings that participate in the Lead Quality / Appointment Rate
// KPI classifier. These are pinned in the settings UI as SYSTEM reasons —
// users can't delete them — because the classifier's case handling would
// break silently otherwise.
//
// Exactly two roles:
//   • no_show — the lead had an appointment but didn't show up. Still counts
//     as QUALIFIED (they demonstrated intent; execution broke).
//   • cold   — the lead never engaged (no reply, didn't want to come). Counts
//     as UNQUALIFIED — marketing didn't convert them.
//
// Any other lost reason (e.g. "Fee too expensive", "Enrolled other school")
// is user-managed and defaults to QUALIFIED — the lead was real, the school
// just didn't win them.

export type SystemLostReasonRole = 'no_show' | 'cold';

export interface SystemLostReason {
  label: string;
  role: SystemLostReasonRole;
}

export const SYSTEM_LOST_REASONS: readonly SystemLostReason[] = [
  { label: 'Missed appointment',                role: 'no_show' },
  { label: 'No response or declined appointment', role: 'cold' },
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

export type VisitOutcomeStored = 'ATTENDED' | null;

export function deriveIsQualified(status: LeadStatus | string, lostReason: string | null | undefined): boolean {
  if (status === 'REJECTED') return false;
  if (status === 'LOST' && systemRoleFor(lostReason) === 'cold') return false;
  return true;
}

export function deriveVisitOutcome(status: LeadStatus | string, attended: boolean): VisitOutcomeStored {
  if (status === 'FOLLOW_UP' || status === 'ENROLLED') return 'ATTENDED';
  if (status === 'LOST' && attended) return 'ATTENDED';
  return null;
}
