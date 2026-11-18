import { describe, it, expect } from 'vitest';
import { stripHiddenTemplates, templateGroupOf, visibleTemplateGroups } from '../../services/messageTemplates.logic.js';

describe('Message templates — groups by module', () => {
  it('puts a template without a known group in Common', () => {
    expect(templateGroupOf({})).toBe('COMMON');
    expect(templateGroupOf({ group: 'FINANCE' })).toBe('COMMON');
    expect(templateGroupOf({ group: 'HR' })).toBe('HR');
  });

  it('shows Common to everyone and each other group only with its module', () => {
    expect([...visibleTemplateGroups(() => false)]).toEqual(['COMMON']);
    expect([...visibleTemplateGroups(m => m === 'MARKETING')]).toEqual(['COMMON', 'MARKETING']);
    expect([...visibleTemplateGroups(() => true)]).toEqual(['COMMON', 'MARKETING', 'HR']);
  });

  it('removes the hidden groups’ built-in and custom templates and leaves other settings alone', () => {
    const s: Record<string, unknown> = {
      epf_enabled: true, whatsapp_template: 'Hi', interview_wa_template: 'Interview',
      whatsapp_custom_templates: [{ id: 'a', group: 'HR' }, { id: 'b' }],
    };
    stripHiddenTemplates(s, new Set(['COMMON', 'MARKETING']));
    expect(s).toEqual({ epf_enabled: true, whatsapp_template: 'Hi', whatsapp_custom_templates: [{ id: 'b' }] });
  });
});
