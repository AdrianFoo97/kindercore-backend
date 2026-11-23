import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { systemSettings, userAuthRoles, users } from '../../db/schema.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';

// Everyone can open Settings, but only change their own area's settings
// (constants/settingKeyAccess.ts) — over real HTTP, signed in as each role.

let server: LiveServer;
const as: Record<string, Caller> = {};
const ROLES = {
  marketing: 'builtin:MARKETING_EXECUTIVE', finance: 'builtin:ACCOUNTS_EXECUTIVE', lead: 'builtin:TEAM_LEAD',
  hrm: 'builtin:HR_MANAGER', director: 'builtin:HR_DIRECTOR', teacher: 'builtin:TEACHER',
};

beforeAll(async () => {
  await resetTables(systemSettings, userAuthRoles, users);
  for (const [who, role] of Object.entries(ROLES)) {
    await db.insert(users).values(await activeUser({ id: `u-${who}`, email: `${who}@kindertech.test`, role: 'USER', authRoleId: role }));
  }
  server = await startLiveServer();
  for (const who of Object.keys(ROLES)) as[who] = await signIn(server.base, `${who}@kindertech.test`, PASSWORD);
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const save = (who: string, key: string, value: unknown) => as[who].call('PATCH', `/api/settings/${key}`, { value });

describe('Settings — each area changes only its own settings', () => {
  it('lets Marketing change CRM and parent message settings, and nothing else', async () => {
    expect((await save('marketing', 'appointment_duration_minutes', 45)).status).toBe(200);
    expect((await save('marketing', 'whatsapp_template_zh', '你好')).status).toBe(200);
    for (const key of ['profit_share_percent', 'company_vision', 'interview_wa_template', 'onboarding_tasks']) {
      expect((await save('marketing', key, 1)).status, key).toBe(403);
    }
  });

  it('lets Finance change the finance ratios, not Marketing’s', async () => {
    expect((await save('finance', 'profit_share_percent', 0.1)).status).toBe(200);
    expect((await save('finance', 'appointment_duration_minutes', 30)).status).toBe(403);
  });

  it('keeps recruitment, appraisal set-up and pay settings for HR with the matching functions — not a Team Lead', async () => {
    for (const [key, value] of [['appraisal_score_bands', []], ['interview_duration_minutes', 60]] as const) {
      expect((await save('lead', key, value)).status, key).toBe(403);
      expect((await save('hrm', key, value)).status, key).toBe(200);
    }
    // Pay settings: the HR Director only — not an HR Manager.
    expect((await save('hrm', 'epf_rate_above', 12)).status).toBe(403);
    expect((await save('director', 'epf_rate_above', 12)).status).toBe(200);
  });

  it('keeps unlisted and company-wide settings Admin-only, and never lets a teacher change any', async () => {
    for (const who of Object.keys(ROLES)) {
      expect((await save(who, 'company_vision', 'x')).status, who).toBe(403);
      expect((await save(who, 'some_new_setting', 'x')).status, who).toBe(403);
    }
    expect((await save('teacher', 'appointment_duration_minutes', 45)).status).toBe(403);
  });

  it('lets each area change its own catalogs: Marketing the programmes, HR the career missions, Finance the cost groups', async () => {
    expect((await as.marketing.call('PUT', '/api/packages/programmes', { programmes: [] })).status).not.toBe(403);
    expect((await as.lead.call('POST', '/api/career-missions', {})).status).not.toBe(403);
    expect((await as.finance.call('POST', '/api/operating-cost/groups', {})).status).not.toBe(403);
    expect((await as.teacher.call('POST', '/api/career-missions', {})).status).toBe(403);
    expect((await as.marketing.call('POST', '/api/operating-cost/groups', {})).status).toBe(403);
  });
});
