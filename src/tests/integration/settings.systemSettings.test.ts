import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { authRoleModules, authRoles, systemSettings, users } from '../../db/schema.js';
import { getSettings, updateSetting } from '../../controllers/settings.controller.js';
import { SYSTEM_LOST_REASON_LABELS } from '../../constants/lostReasons.js';
import { resetTables } from './testDb.js';
import { req, reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Settings: the app-wide values every page reads (thresholds, finance %,
// templates, lead "lost reasons"). Real handlers, real (test) DB.

beforeEach(async () => {
  await resetTables(systemSettings);
});
afterAll(async () => {
  await pool.end();
});

const save = async (key: string, value: unknown) => { const r = res(); await updateSetting(req({ value }, { key }), r); return r; };
const ADMIN = { id: 'user-admin', email: 'admin@kindertech.test', role: 'ADMIN' };
const readAll = async (user = ADMIN) => { const r = res(); await getSettings(reqWith({ user }), r); return r.body as Record<string, unknown>; };

describe('Settings — saving and reading app settings', () => {
  it('saves numbers, on/off switches, text and lists, and reads them back as the same type', async () => {
    await save('epf_rate_below', 13);
    await save('epf_enabled', false);
    await save('whatsapp_template', 'Hi {{childName}}!');
    await save('branches', ['Danga Bay', 'Mount Austin']);
    expect(await readAll()).toMatchObject({
      epf_rate_below: 13, epf_enabled: false, whatsapp_template: 'Hi {{childName}}!', branches: ['Danga Bay', 'Mount Austin'],
    });
  });

  it('updates an existing setting instead of creating a duplicate', async () => {
    await save('epf_rate_below', 13);
    await save('epf_rate_below', 11);
    expect((await readAll()).epf_rate_below).toBe(11);
    expect((await db.select().from(systemSettings)).length).toBe(1);
  });

  it('rejects a value of the wrong shape', async () => {
    const r = await save('epf_rate_below', { nested: { object: true } });
    expect(r.statusCode).toBe(400);
  });
});

describe('Settings — onboarding checklists', () => {
  it('saves items with a description or a link button, and refuses a button without a label or with an unsafe link', async () => {
    const ok = await save('onboarding_tasks', [{ task: ' Collect birth cert ', description: 'The original, not a photo.' }, { task: 'Parent app', linkLabel: 'Download', linkUrl: 'https://kindertech.example/app' }]);
    expect(ok.statusCode).toBe(200);
    expect((await readAll()).onboarding_tasks).toEqual([{ task: 'Collect birth cert', description: 'The original, not a photo.' }, { task: 'Parent app', linkLabel: 'Download', linkUrl: 'https://kindertech.example/app' }]);
    expect((await save('onboarding_tasks', [{ task: 'Parent app', linkUrl: 'https://kindertech.example/app' }])).statusCode).toBe(400);
    expect((await save('onboarding_tasks', [{ task: 'Parent app', linkLabel: 'Go', linkUrl: 'javascript:alert(1)' }])).statusCode).toBe(400);
  });
});

describe('Settings — lead "lost reasons" list', () => {
  it('always keeps the built-in reasons first, even if an admin removes them', async () => {
    const r = await save('lost_reasons', ['Too far from home']);
    expect(r.body.value).toEqual([...SYSTEM_LOST_REASON_LABELS, 'Too far from home']);
  });

  it('drops blanks and duplicates but keeps the admin\'s order', async () => {
    const r = await save('lost_reasons', ['  Fees too high ', '', 'Too far from home', 'Fees too high']);
    expect(r.body.value).toEqual([...SYSTEM_LOST_REASON_LABELS, 'Fees too high', 'Too far from home']);
  });

  it('does not let a built-in reason be added twice', async () => {
    const r = await save('lost_reasons', [SYSTEM_LOST_REASON_LABELS[0], 'Moved away']);
    expect(r.body.value).toEqual([...SYSTEM_LOST_REASON_LABELS, 'Moved away']);
  });

  it('shows the built-in reasons even before anything has been saved', async () => {
    expect((await readAll()).lost_reasons).toEqual([...SYSTEM_LOST_REASON_LABELS]);
  });
});

describe('Settings — message templates by group', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');
  const MARK = { id: 'u-mark', email: 'mark@kindertech.test', role: 'USER' };
  const HANA = { id: 'u-hana', email: 'hana@kindertech.test', role: 'USER' };
  const NOBODY = { id: 'u-nobody', email: 'nobody@kindertech.test', role: 'USER' };
  beforeEach(async () => {
    await resetTables(users, authRoleModules, authRoles);
    await db.insert(authRoles).values([
      { id: 'role-mkt', name: 'Marketing Executive', createdAt: NOW, updatedAt: NOW },
      { id: 'role-hr', name: 'HR Executive', createdAt: NOW, updatedAt: NOW },
    ]);
    await db.insert(authRoleModules).values([
      { id: 'arm-mkt', authRoleId: 'role-mkt', module: 'MARKETING', createdAt: NOW },
      { id: 'arm-hr', authRoleId: 'role-hr', module: 'HR', createdAt: NOW },
    ]);
    await db.insert(users).values([
      await activeUser({ id: MARK.id, email: MARK.email, role: 'USER', authRoleId: 'role-mkt' }),
      await activeUser({ id: HANA.id, email: HANA.email, role: 'USER', authRoleId: 'role-hr' }),
      await activeUser({ id: NOBODY.id, email: NOBODY.email, role: 'USER' }),
    ]);
    await save('whatsapp_template', 'Hi parent');
    await save('offer_wa_template', 'Your offer');
    await save('whatsapp_custom_templates', [
      { id: 'c1', name: 'Holiday notice', group: 'COMMON', content_en: 'Closed', content_zh: '' },
      { id: 'c2', name: 'Open day', group: 'MARKETING', content_en: 'Come', content_zh: '' },
      { id: 'c3', name: 'Payslip ready', group: 'HR', content_en: 'Ready', content_zh: '' },
      { id: 'c4', name: 'Old one', content_en: 'No group yet', content_zh: '' },
    ]);
  });
  const customNames = (s: Record<string, unknown>) => (s.whatsapp_custom_templates as { name: string }[]).map(t => t.name);

  it('gives everyone the Common templates, including older ones saved without a group', async () => {
    const s = await readAll(NOBODY);
    expect(customNames(s)).toEqual(['Holiday notice', 'Old one']);
    expect(s).not.toHaveProperty('whatsapp_template');
    expect(s).not.toHaveProperty('offer_wa_template');
  });

  it('gives Marketing templates only to people with the Marketing module', async () => {
    const s = await readAll(MARK);
    expect(customNames(s)).toEqual(['Holiday notice', 'Open day', 'Old one']);
    expect(s.whatsapp_template).toBe('Hi parent');
    expect(s).not.toHaveProperty('offer_wa_template');
  });

  it('gives HR templates only to people with the HR module', async () => {
    const s = await readAll(HANA);
    expect(customNames(s)).toEqual(['Holiday notice', 'Payslip ready', 'Old one']);
    expect(s.offer_wa_template).toBe('Your offer');
    expect(s).not.toHaveProperty('whatsapp_template');
  });

  it('gives an admin every group', async () => {
    const s = await readAll();
    expect(customNames(s)).toHaveLength(4);
    expect(s).toMatchObject({ whatsapp_template: 'Hi parent', offer_wa_template: 'Your offer' });
  });
});
