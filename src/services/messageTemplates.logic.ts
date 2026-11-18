// Message templates are grouped by module: Common is for everyone; each other
// group is only for people with that module (Marketing → Marketing, HR → HRMS).
// GET /api/settings drops the groups a person can't use, so their text never
// reaches the browser. Mirrored for the screens in
// kindercore-frontend/src/pages/messageTemplateGroups.ts — keep both in sync.
import { MODULES } from '../constants/authModules.js';

export const TEMPLATE_GROUPS = [
  { key: 'COMMON', label: 'Common', module: null },
  { key: 'MARKETING', label: 'Marketing', module: MODULES.MARKETING },
  { key: 'HR', label: 'HR', module: MODULES.HR },
] as const;
export type TemplateGroupKey = typeof TEMPLATE_GROUPS[number]['key'];

export const CUSTOM_TEMPLATES_KEY = 'whatsapp_custom_templates';

/** The built-in templates' setting keys (English + Chinese), by group. */
export const BUILT_IN_TEMPLATE_KEYS: Record<Exclude<TemplateGroupKey, 'COMMON'>, string[]> = {
  MARKETING: [
    'whatsapp_template', 'whatsapp_template_zh',
    'whatsapp_followup_template', 'whatsapp_followup_template_zh',
    'whatsapp_confirm_appt_template', 'whatsapp_confirm_appt_template_zh',
  ],
  HR: [
    'interview_wa_template', 'interview_wa_template_zh',
    'interview_confirm_wa_template', 'interview_confirm_wa_template_zh',
    'offer_wa_template', 'offer_wa_template_zh',
  ],
};

/** A custom template's group — Common when it has none (or an unknown one). */
export function templateGroupOf(t: { group?: unknown }): TemplateGroupKey {
  return TEMPLATE_GROUPS.find(g => g.key === t.group)?.key ?? 'COMMON';
}

/** The groups someone may use, given which modules they have. */
export function visibleTemplateGroups(hasModule: (m: string) => boolean): Set<TemplateGroupKey> {
  return new Set(TEMPLATE_GROUPS.filter(g => g.module === null || hasModule(g.module)).map(g => g.key));
}

/** Removes the templates of groups not in `visible` from a settings object (in place). */
export function stripHiddenTemplates(settings: Record<string, unknown>, visible: Set<TemplateGroupKey>): void {
  for (const [group, keys] of Object.entries(BUILT_IN_TEMPLATE_KEYS)) {
    if (!visible.has(group as TemplateGroupKey)) for (const k of keys) delete settings[k];
  }
  const custom = settings[CUSTOM_TEMPLATES_KEY];
  if (Array.isArray(custom)) {
    settings[CUSTOM_TEMPLATES_KEY] = custom.filter(t => visible.has(templateGroupOf((t ?? {}) as { group?: unknown })));
  }
}
