// The two deliberate exceptions to "every endpoint is locked down", in one
// place. Read by the static route checks (security.publicEndpoints /
// security.accessRules) AND the live HTTP sweep (security.httpSweep), so an
// approval here is the only way an endpoint may be reachable without a role.
//
// To approve an endpoint, add it WITH a reason, and make sure the handler
// protects itself (validation, rate limit, one-time token, "own rows only"…).

/** Reachable without signing in. */
export const APPROVED_PUBLIC: Record<string, string> = {
  'POST /api/auth/login': 'The login form — you are not signed in yet. Rate-limited in server.ts.',
  'POST /api/auth/logout': 'Clears the caller\'s own session cookie — it can only ever sign the caller out.',
  'GET /api/auth/invite/:token': 'Invite link check before an account exists; the long random token is the credential.',
  'POST /api/auth/activate': 'Sets a password from an invite; needs the one-time, expiring invite token.',
  'POST /api/leads': 'Public enquiry form on the website. Honeypot-protected.',
  'GET /api/marketing-campaigns/check': 'Enquiry form checks a promo code is valid.',
  'POST /api/candidates': 'Public job application form.',
  'GET /api/candidates/form-options': 'Job application form loads its dropdown options.',
  'POST /api/staff-joins': 'Public "New staff" form for joiners who skipped Recruitment. Honeypot-protected, rate-limited in server.ts, echoes nothing back; HR approval is signed-in.',
  'POST /api/candidates/:id/resume': 'Applicant attaches a resume right after applying; one upload only, within a short window.',
  'GET /api/google/auth': 'Starts Google Calendar connection; the redirect carries a signed state token.',
  'GET /api/google/callback': 'Google redirects back here; verified by the signed state token.',
  // No user login, but guarded by readerOrStaffMiddleware: the reader's
  // X-Reader-Key or a signed-in staff member. Only enforced once
  // ATTENDANCE_READER_KEY is set on the server (see reader.middleware.ts).
  'POST /api/attendance/scan': 'Physical RFID readers at the door have no user login — they use a reader key instead.',
};

/** Reachable by ANY signed-in person (no role/module/ownership gate). Read-only reference data, or scoped to the caller inside the handler. */
export const APPROVED_ANY_SIGNED_IN: Record<string, string> = {
  'GET /api/me/permissions': 'Your own permissions — scoped to the caller.',
  'GET /api/notifications': 'Your own notifications only — filtered to the caller.',
  'GET /api/auth/me/photo': 'Your own profile photo — always the caller\'s, no user id in the address.',
  'PUT /api/auth/me/photo': 'Sets your own profile photo — always the caller\'s.',
  'PUT /api/auth/me/display-name': 'Sets your own display name — always the caller\'s.',
  'DELETE /api/auth/me/photo': 'Removes your own profile photo — always the caller\'s.',
  'POST /api/notifications/read-all': 'Marks only the caller\'s own notifications read.',
  'GET /api/notifications/settings': 'Which events the caller receives — their own choices only.',
  'PUT /api/notifications/settings': 'Saves the caller\'s own notification choices; unknown events are refused.',
  'POST /api/notifications/:id/read': 'Marks one of the caller\'s own notifications read; anyone else\'s answers 404.',
  'GET /api/settings': 'App-wide settings the whole app reads; secret.* settings are filtered out.',
  'GET /api/packages': 'Fee package catalog (reference data).',
  'GET /api/packages/years': 'Package years (reference data).',
  'GET /api/packages/config': 'Package configuration (reference data).',
  'GET /api/allowance-types': 'Allowance type names (reference data, no per-person amounts).',
  'GET /api/auth-roles': 'Access role names for pickers (no permissions are granted by reading them).',
  'POST /api/bug-reports': 'Anyone signed in can report a bug.',
  'GET /api/career-missions': 'Mission catalog the teacher career page lists.',
  'GET /api/mission-categories': 'Mission categories for the teacher career badges.',
  'GET /api/points/rules': 'Earning-rule catalog shown on the teacher "Earn points" page.',
  'GET /api/points/rewards': 'Reward catalog teachers redeem from.',
  'GET /api/redemptions/:id': 'One redemption — the handler only returns it to its owner, HR or Admin.',
  'GET /api/planner/teachers': 'Staff list — the handler returns colleagues as name/colour only unless the caller has HR/Tools/Finance/Analysis.',
  'GET /api/salary/departments': 'Department names (reference data).',
  'GET /api/salary/positions': 'Position salary bands — the same bands the public job application form shows.',
  'GET /api/salary/level-incentives': 'Level incentive table (reference data, not per person).',
  'GET /api/sop-templates': 'How-to guide library every staff member reads.',
  'GET /api/sop-steps': 'Steps of the how-to guides.',
  'GET /api/sop-sections': 'Guide section names.',
  'GET /api/sop-categories': 'Guide category labels.',
  'GET /api/sop-revisions': 'Guide improvement proposals — the handler shows non-reviewers only their own.',
  'GET /api/sop-revisions/:id': 'One proposal — scoped in the handler like the list.',
  'POST /api/sop-revisions': 'Any staff member can propose an improvement to a guide.',
  'POST /api/sop-steps/images': 'A photo for a guide step — anyone who can propose a guide change can add one; it only shows once a step uses it.',
  'GET /api/sop-templates/:id/poster/image/:imageId': 'A How-To Guide poster picture — guides are read by all staff.',
  'GET /api/sop-steps/images/:id': 'A guide step photo — guides are read by all staff.',
  'POST /api/sop-revisions/:id/resubmit': 'Resending your own suggestion after a send-back — the handler only allows the person who sent it.',
  'POST /api/upload/bug-report-photos': 'Screenshots attached to a bug report (anyone signed in can report a bug).',
  'POST /api/incidents': 'Any staff member must be able to report an incident with a child, straight away.',
  'GET /api/incidents/mine': 'The caller\'s own incident reports only.',
  'GET /api/incidents/student-options': 'Current students\' names (id + name only) for picking who was involved in an incident.',
  'POST /api/facility-issues': 'Any staff member can report something broken in the building (door, leaking pipe…).',
  'GET /api/facility-issues/mine': 'The caller\'s own facility reports only.',
  'POST /api/purchase-requests': 'Any staff member can ask for something to be bought for their class.',
  'GET /api/purchase-requests/mine': 'The caller\'s own purchase requests only (cost and receipt left out).',
  'PATCH /api/purchase-requests/:id': 'Editing your own purchase request — the handler allows only the requester, and only before approval.',
  'DELETE /api/purchase-requests/:id': 'Withdrawing your own purchase request — the handler allows only the requester, and only before approval.',
  'POST /api/purchase-requests/:id/bought-myself': 'Marking your own self-buy as bought (cost + receipt) — the handler allows only the requester, only for "I\'ll buy it myself" requests, and only once approved.',
  'GET /api/purchase-requests/:id/photos/:fileId': 'A purchase request\'s photo — the handler only serves it to the requester, shopping-list managers or Admins.',
  'GET /api/facility-issues/:id/attachments/:fileId': 'A report\'s photo / video — the handler only serves it to the reporter, facility managers or Admins.',
};
