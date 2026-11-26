import { MODULES, type ModuleKey } from './authModules.js';

// Who may change each system setting (PATCH /api/settings/:key) — the people
// whose Settings page it is on (frontend pages/settings/settingsNav.ts uses
// the same areas). Admins may change any. A key not listed here stays
// Admin-only, so a new setting is safe until someone owns it.

/** One kind of access: a module, plus a function inside it when needed. */
export interface AccessNeed { module: ModuleKey; fn?: string }

const MARKETING: AccessNeed[] = [{ module: MODULES.MARKETING }];
const STUDENTS: AccessNeed[] = [{ module: MODULES.STUDENTS }];
/** Finance targets: they drive the Profit Sharing / Annual Bonus reports. */
const ANALYSIS: AccessNeed[] = [{ module: MODULES.ANALYSIS }];
/** Whole-school HR (recruitment, onboarding, appraisal set-up). */
const WHOLE_SCHOOL_HR: AccessNeed[] = [{ module: MODULES.HR, fn: 'HR_SEE_ALL_STAFF' }];
/** HR with “See pay & salaries” (statutory contributions). */
const HR_PAY: AccessNeed[] = [{ module: MODULES.HR, fn: 'HR_SEE_PAY' }];

const byKey = (keys: string[], need: AccessNeed[]) => Object.fromEntries(keys.map(k => [k, need]));
/** Both languages of a WhatsApp template. */
const bothLanguages = (keys: string[]) => keys.flatMap(k => [k, `${k}_zh`]);

export const SETTING_KEY_ACCESS: Record<string, AccessNeed[]> = {
  // Marketing → CRM, Packages & pricing, Message templates (parents).
  ...byKey([
    'appointment_duration_minutes', 'appointment_lead_time_hours', 'kinder_address', 'urgency_orange_days', 'urgency_red_days', 'lost_reasons',
    'package_ages', 'package_programmes', 'whatsapp_custom_templates',
    ...bothLanguages(['whatsapp_template', 'whatsapp_followup_template', 'whatsapp_confirm_appt_template']),
  ], MARKETING),
  // Students → Student onboarding.
  ...byKey(['onboarding_tasks', 'school_news_enrolments'], STUDENTS),
  // Recruitment & Hiring, Staff onboarding, Performance (score bands), Message templates (applicants).
  ...byKey([
    'staff_onboarding_tasks', 'staff_self_onboarding_tasks',
    'recruitment_positions', 'recruitment_qualifications', 'recruitment_experience_ranges', 'recruitment_referral_sources',
    'interview_duration_minutes', 'recruitment_interview_confirm_lead_days', 'appraisal_score_bands',
    ...bothLanguages(['interview_wa_template', 'interview_confirm_wa_template', 'offer_wa_template']),
  ], WHOLE_SCHOOL_HR),
  // Money → Finance targets — for whoever runs the pool reports. (The High Performer / Performer marks are the score bands now.)
  ...byKey(['expense_ratio_target', 'profit_share_percent', 'annual_bonus_percent'], ANALYSIS),
};

/** Statutory contributions (Payroll → Allowances): EPF / SOCSO / EIS rates, ceilings and switches. */
const PAY_PREFIXES = ['epf_', 'socso_', 'eis_'];

/** Who may change this setting besides Admins, or null when it's Admin-only. */
export function settingKeyAccess(key: string): AccessNeed[] | null {
  if (key in SETTING_KEY_ACCESS) return SETTING_KEY_ACCESS[key];
  if (PAY_PREFIXES.some(p => key.startsWith(p))) return HR_PAY;
  return null;
}

/** Does someone with these grants meet any of the needs? */
export function meetsAny(needs: AccessNeed[], grants: { modules: Set<string>; views: Set<string> }): boolean {
  return needs.some(n => grants.modules.has(n.module) && (!n.fn || grants.views.has(n.fn)));
}
