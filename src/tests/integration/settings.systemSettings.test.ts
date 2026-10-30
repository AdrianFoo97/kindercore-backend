import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { getSettings, updateSetting } from '../../controllers/settings.controller.js';
import { SYSTEM_LOST_REASON_LABELS } from '../../constants/lostReasons.js';
import { resetTables } from './testDb.js';
import { req, res } from './http.js';

// Settings: the app-wide values every page reads (thresholds, finance %,
// templates, lead "lost reasons"). Real handlers, real (test) DB.

beforeEach(async () => {
  await resetTables(systemSettings);
});
afterAll(async () => {
  await pool.end();
});

const save = async (key: string, value: unknown) => { const r = res(); await updateSetting(req({ value }, { key }), r); return r; };
const readAll = async () => { const r = res(); await getSettings(req(), r); return r.body as Record<string, unknown>; };

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
