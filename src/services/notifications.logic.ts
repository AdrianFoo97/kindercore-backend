// In-app notifications — what each event says, where it takes you, and who
// may receive it. One function per event, so the wording and the link live in
// one place.
import { MODULES } from '../constants/authModules.js';

export type NotificationKind =
  | 'NEW_LEAD' | 'NEW_STUDENT' | 'STUDENT_WITHDRAWN' | 'NEW_APPLICATION' | 'NEW_STAFF_JOIN' | 'INCIDENT_REPORTED'
  | 'APPRAISAL_SIGN_OFF' | 'ONBOARDING_SELF_DONE' | 'FACILITY_REPORTED' | 'ITEM_REQUESTED' | 'GUIDE_SUGGESTED'
  | 'ITEM_BOUGHT' | 'COSTS_RECORDED' | 'BUG_REPORTED'
  | 'MY_REQUEST_UPDATE' | 'MY_REPORT_UPDATE' | 'MY_APPRAISAL_READY' | 'MY_POINTS' | 'MY_REWARD_DELIVERED';

export interface NotificationMessage { kind: NotificationKind; title: string; body: string | null; link: string }

/** One kind of access: a module, plus a function inside it when the page needs one. */
export interface AccessNeed { module: string; fn?: string }

/**
 * Who may receive an event: the same access as the page it opens. Admins can
 * open everything, so they may receive every event. Nobody is told about
 * something they can't act on.
 */
export interface NotificationAudience {
  /** Any one of these is enough. */
  anyOf: AccessNeed[];
  /** Sent only to the people the event names (e.g. an appraisal's sign-off people), not everyone eligible. */
  targeted?: boolean;
  /**
   * About your own things (your request, your report, your appraisal, your
   * points) — offered to every staff member, whatever their roles, and sent
   * only to the person it's about.
   */
  personal?: boolean;
}

const PERSONAL: NotificationAudience = { anyOf: [], targeted: true, personal: true };

export interface NotificationEvent { kind: NotificationKind; category: string; label: string; description: string; audience: NotificationAudience }

const only = (module: string, fn?: string): NotificationAudience => ({ anyOf: [{ module, fn }] });

/**
 * Who can sign off an appraisal: HR, or someone who manages something in
 * Operation (supervisors, managers). A plain Teacher role is left out — they
 * can't open someone else's appraisal.
 */
const SIGN_OFF_AUDIENCE: NotificationAudience = {
  anyOf: [
    { module: MODULES.HR },
    ...['OPERATION_SOP_APPROVE', 'OPERATION_INCIDENT_MANAGE', 'OPERATION_PURCHASE_MANAGE', 'OPERATION_FACILITY_MANAGE']
      .map(fn => ({ module: MODULES.OPERATION, fn })),
  ],
  targeted: true,
};

/** Every event someone can be notified about, grouped for Settings → Notifications. Order = display order. */
export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  { kind: 'NEW_LEAD', category: 'Marketing', label: 'New lead', description: 'A parent sends the enquiry form on the website.', audience: only(MODULES.MARKETING) },
  { kind: 'NEW_STUDENT', category: 'Students', label: 'New student', description: 'A child is added as a student — ready for onboarding.', audience: only(MODULES.STUDENTS) },
  { kind: 'STUDENT_WITHDRAWN', category: 'Students', label: 'Student withdrawn', description: 'A student is withdrawn from the centre.', audience: only(MODULES.STUDENTS) },
  { kind: 'NEW_APPLICATION', category: 'Recruitment & HR', label: 'New job application', description: 'Someone applies through the job application form.', audience: only(MODULES.HR) },
  { kind: 'NEW_STAFF_JOIN', category: 'Recruitment & HR', label: 'New staff joining', description: 'A new joiner sends the New staff form and waits for approval.', audience: only(MODULES.HR) },
  { kind: 'ONBOARDING_SELF_DONE', category: 'Recruitment & HR', label: 'New staff finished their checklist', description: 'A new joiner ticks off their own onboarding checklist — ready for HR to complete.', audience: only(MODULES.HR) },
  { kind: 'APPRAISAL_SIGN_OFF', category: 'Recruitment & HR', label: 'Appraisal ready for sign-off', description: 'An appraisal you sign off has been scored and is waiting for you.', audience: SIGN_OFF_AUDIENCE },
  { kind: 'INCIDENT_REPORTED', category: 'Operation', label: 'Incident reported', description: 'A staff member reports an incident involving a child.', audience: only(MODULES.OPERATION, 'OPERATION_INCIDENT_MANAGE') },
  { kind: 'FACILITY_REPORTED', category: 'Operation', label: 'Facility issue reported', description: 'Something broken or unsafe is reported (door, furniture, plumbing…).', audience: only(MODULES.OPERATION, 'OPERATION_FACILITY_MANAGE') },
  { kind: 'ITEM_REQUESTED', category: 'Operation', label: 'Item requested', description: 'A staff member asks for something to be bought (shopping list).', audience: only(MODULES.OPERATION, 'OPERATION_PURCHASE_MANAGE') },
  { kind: 'GUIDE_SUGGESTED', category: 'Operation', label: 'Guide change suggested', description: 'A staff member suggests a new How-To Guide or a change to one (or resubmits it).', audience: only(MODULES.OPERATION, 'OPERATION_SOP_APPROVE') },
  { kind: 'ITEM_BOUGHT', category: 'Finance', label: 'Item bought', description: 'A shopping-list item is bought and its cost entered — to add to operating costs.', audience: only(MODULES.FINANCE) },
  { kind: 'COSTS_RECORDED', category: 'Analysis', label: 'Month’s operating costs recorded', description: 'Operating costs are entered for a month for the first time — its reports now include them.', audience: only(MODULES.ANALYSIS) },
  { kind: 'BUG_REPORTED', category: 'System', label: 'Bug reported', description: 'Someone reports a problem with the app.', audience: only(MODULES.TOOLS) },
  { kind: 'MY_REQUEST_UPDATE', category: 'About you', label: 'Your item requests', description: 'Something you asked to be bought is approved, bought or turned down.', audience: PERSONAL },
  { kind: 'MY_REPORT_UPDATE', category: 'About you', label: 'Your reports', description: 'An incident or facility issue you reported changes status.', audience: PERSONAL },
  { kind: 'MY_APPRAISAL_READY', category: 'About you', label: 'Your appraisal', description: 'Your appraisal is signed off and waiting for you to confirm.', audience: PERSONAL },
  { kind: 'MY_POINTS', category: 'About you', label: 'Points you receive', description: 'You’re granted points.', audience: PERSONAL },
  { kind: 'MY_REWARD_DELIVERED', category: 'About you', label: 'Your rewards', description: 'A reward you redeemed is delivered or approved.', audience: PERSONAL },
];
export const NOTIFICATION_KINDS = NOTIFICATION_EVENTS.map(e => e.kind);

/** True when this access (one role, or everything someone holds) is enough to receive the event. */
export function grantsAudience(access: { modules: Iterable<string>; functions: Iterable<string> }, audience: NotificationAudience): boolean {
  const modules = new Set(access.modules);
  const functions = new Set(access.functions);
  return audience.anyOf.some(n => modules.has(n.module) && (!n.fn || functions.has(n.fn)));
}

/**
 * True when someone may receive this kind at all: personal events need a
 * staff record (it's about their own work); the rest need their roles (or admin).
 */
export function mayReceive(kind: NotificationKind, roles: { modules: string[]; functions: string[] }[], isAdmin: boolean, isStaff: boolean): boolean {
  const event = NOTIFICATION_EVENTS.find(e => e.kind === kind);
  if (!event) return false;
  if (event.audience.personal) return isStaff;
  return isAdmin || grantsAudience({ modules: roles.flatMap(r => r.modules), functions: roles.flatMap(r => r.functions) }, event.audience);
}

/** Label used for admins in "From …" (they get every event by being an admin). */
export const ADMIN_SOURCE = 'Admin account';
/** Label used for personal events — they come from being on the staff, not a role. */
export const PERSONAL_SOURCE = 'Your own work';

/**
 * The events someone may receive, each with the role(s) that give it and
 * whether they've switched it off — what Settings → Notifications shows.
 */
export function notificationSettings(roles: { name: string; modules: string[]; functions: string[] }[], isAdmin: boolean, muted: Iterable<string>, isStaff = false) {
  const off = new Set(muted);
  return NOTIFICATION_EVENTS.flatMap(e => {
    const from = e.audience.personal ? (isStaff ? [PERSONAL_SOURCE] : [])
      : isAdmin ? [ADMIN_SOURCE] : roles.filter(r => grantsAudience(r, e.audience)).map(r => r.name);
    if (!from.length) return [];
    const { audience: _audience, ...shown } = e;
    return [{ ...shown, from, enabled: !off.has(e.kind) }];
  });
}


/** How long a notification is kept before it's cleared away. */
export const NOTIFICATION_RETENTION_DAYS = 180;
/** How many of someone's latest notifications the bell shows. */
export const NOTIFICATION_LIST_LIMIT = 30;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function newLeadMessage(lead: { id: string; childName: string; programme?: string | null }): NotificationMessage {
  return {
    kind: 'NEW_LEAD',
    title: clip(`New lead: ${lead.childName}`, 191),
    body: lead.programme ? `Enquiry for ${lead.programme}` : 'New enquiry from the website',
    link: `/leads?edit=${encodeURIComponent(lead.id)}`,
  };
}

export function newStudentMessage(s: { id: string; childName: string }): NotificationMessage {
  return {
    kind: 'NEW_STUDENT',
    title: clip(`New student: ${s.childName}`, 191),
    body: 'Ready for onboarding',
    link: `/students/${encodeURIComponent(s.id)}`,
  };
}

export function studentWithdrawnMessage(s: { id: string; childName: string; reason?: string | null }): NotificationMessage {
  return {
    kind: 'STUDENT_WITHDRAWN',
    title: clip(`Student withdrawn: ${s.childName}`, 191),
    body: s.reason ? clip(s.reason, 300) : null,
    link: `/students/${encodeURIComponent(s.id)}`,
  };
}

/** Cost is RM as stored (e.g. "12.50"). */
export function itemBoughtMessage(p: { item: string; quantity: number | string; cost: string }): NotificationMessage {
  return {
    kind: 'ITEM_BOUGHT',
    title: clip(`Bought: ${p.item} × ${p.quantity} — RM ${p.cost}`, 191),
    body: 'Add it to this month’s operating costs',
    link: '/operations/operating-costs',
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `month` is 1–12. */
export function costsRecordedMessage(m: { year: number; month: number }): NotificationMessage {
  const when = `${MONTH_NAMES[m.month - 1]} ${m.year}`;
  return {
    kind: 'COSTS_RECORDED',
    title: `Operating costs recorded: ${when}`,
    body: `The cost and profit reports for ${when} now include them`,
    link: '/analysis/operating-cost',
  };
}

const teacherPage = (teacherId: string, page: string) => `/teachers/${encodeURIComponent(teacherId)}/${page}`;

const REQUEST_OUTCOME = { APPROVED: 'Approved', BOUGHT: 'Bought', NOT_BUYING: 'Not buying' } as const;

export function myRequestMessage(r: { teacherId: string; item: string; quantity: number | string; outcome: keyof typeof REQUEST_OUTCOME; reason?: string | null }): NotificationMessage {
  return {
    kind: 'MY_REQUEST_UPDATE',
    title: clip(`${REQUEST_OUTCOME[r.outcome]}: ${r.item} × ${r.quantity}`, 191),
    body: r.reason ? clip(r.reason, 300) : null,
    link: teacherPage(r.teacherId, 'purchases'),
  };
}

const REPORT_STATUS: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', PARENT_INFORMED: 'Parent informed', RESOLVED: 'Resolved',
};

export function myReportMessage(r: { teacherId: string; what: 'incident' | 'facility'; place: string; status: string }): NotificationMessage {
  const noun = r.what === 'incident' ? 'incident report' : 'facility issue';
  return {
    kind: 'MY_REPORT_UPDATE',
    title: clip(`Your ${noun}: ${REPORT_STATUS[r.status] ?? r.status}`, 191),
    body: clip(r.place, 300),
    link: teacherPage(r.teacherId, r.what === 'incident' ? 'incidents' : 'facilities'),
  };
}

export function myAppraisalMessage(a: { id: string; formName: string }): NotificationMessage {
  return {
    kind: 'MY_APPRAISAL_READY',
    title: 'Your appraisal is ready to confirm',
    body: clip(a.formName, 300),
    link: `/appraisals/${encodeURIComponent(a.id)}`,
  };
}

export function myPointsMessage(p: { teacherId: string; amount: number; label: string }): NotificationMessage {
  return {
    kind: 'MY_POINTS',
    title: `You received ${p.amount} point${p.amount === 1 ? '' : 's'}`,
    body: clip(p.label, 300),
    link: teacherPage(p.teacherId, 'rewards'),
  };
}

export function myRewardMessage(r: { teacherId: string; label: string }): NotificationMessage {
  return {
    kind: 'MY_REWARD_DELIVERED',
    title: clip(`Reward delivered: ${r.label}`, 191),
    body: null,
    link: teacherPage(r.teacherId, 'rewards'),
  };
}

export function newApplicationMessage(c: { id: string; fullName: string; desiredPosition?: string | null }): NotificationMessage {
  return {
    kind: 'NEW_APPLICATION',
    title: clip(`New job application: ${c.fullName}`, 191),
    body: c.desiredPosition ? `Applied for ${c.desiredPosition}` : 'Applied through the job application form',
    link: `/hr/candidates?candidate=${encodeURIComponent(c.id)}`,
  };
}

export function newStaffJoinMessage(j: { fullName: string }): NotificationMessage {
  return {
    kind: 'NEW_STAFF_JOIN',
    title: clip(`New staff joining: ${j.fullName}`, 191),
    body: 'Waiting for your approval',
    link: '/hr/new-staff',
  };
}

export function incidentMessage(i: { id: string; location: string; reportedByName: string }): NotificationMessage {
  return {
    kind: 'INCIDENT_REPORTED',
    title: 'Incident reported',
    body: clip(`${i.location} · reported by ${i.reportedByName}`, 300),
    link: `/operations/incidents/${encodeURIComponent(i.id)}`,
  };
}

export function appraisalSignOffMessage(a: { id: string; teacherName: string; formName: string; scoredByName: string }): NotificationMessage {
  return {
    kind: 'APPRAISAL_SIGN_OFF',
    title: clip(`Appraisal ready for sign-off: ${a.teacherName}`, 191),
    body: clip(`${a.formName} · scored by ${a.scoredByName}`, 300),
    link: `/appraisals/${encodeURIComponent(a.id)}`,
  };
}

export function onboardingSelfDoneMessage(s: { name: string }): NotificationMessage {
  return {
    kind: 'ONBOARDING_SELF_DONE',
    title: clip(`${s.name} finished their onboarding checklist`, 191),
    body: 'Ready for HR to complete their onboarding',
    link: '/hr/onboarding',
  };
}

export function facilityMessage(f: { title: string; location: string; reportedByName: string }): NotificationMessage {
  return {
    kind: 'FACILITY_REPORTED',
    title: clip(`Facility issue: ${f.title}`, 191),
    body: clip(`${f.location} · reported by ${f.reportedByName}`, 300),
    link: '/operations/facilities',
  };
}

export function itemRequestedMessage(r: { item: string; quantity: number | string; requestedByName: string }): NotificationMessage {
  return {
    kind: 'ITEM_REQUESTED',
    title: clip(`Item requested: ${r.item} × ${r.quantity}`, 191),
    body: clip(`Asked by ${r.requestedByName}`, 300),
    link: '/operations/shopping-list',
  };
}

export function guideSuggestedMessage(g: { id: string; title: string; byName: string; isNewGuide: boolean; resubmitted?: boolean }): NotificationMessage {
  const what = g.resubmitted ? 'Guide change resubmitted' : g.isNewGuide ? 'New guide suggested' : 'Guide change suggested';
  return {
    kind: 'GUIDE_SUGGESTED',
    title: clip(`${what}: ${g.title}`, 191),
    body: clip(`By ${g.byName} · waiting for review`, 300),
    link: `/hr/sop-revisions/${encodeURIComponent(g.id)}`,
  };
}

export function bugReportedMessage(b: { title: string; reportedByName: string }): NotificationMessage {
  return {
    kind: 'BUG_REPORTED',
    title: clip(`Bug reported: ${b.title}`, 191),
    body: clip(`Reported by ${b.reportedByName}`, 300),
    link: '/tools/bug-reports',
  };
}
