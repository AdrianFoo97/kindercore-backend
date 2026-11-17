import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../db/client.js';
import {
  appraisalAssignments, appraisalCriteria, appraisalCriterionPoints, appraisalLogs, appraisalScores, appraisalSections, appraisalStagePositions,
  appraisalStages, appraisalTemplates, appraisals, positions, teacherAppraisals, teachers, users,
} from '../../db/schema.js';
import {
  acknowledgeAppraisalRun, approveAppraisalRun, cancelAppraisalRun, getAppraisalRun, getMyAppraisalTasks,
  saveAppraisalRunScores, sendBackAppraisalRun, submitAppraisalRun,
} from '../../controllers/appraisal-runs.controller.js';
import { SCHEDULER, createRun, runsCovering } from '../../services/appraisalRuns.service.js';
import { startOneOff } from '../../services/appraisalSchedules.service.js';
import { FROM_FORM_MESSAGE, deleteAppraisal, upsertAppraisal } from '../../controllers/teacher-appraisals.controller.js';
import { activateTemplate, createTemplate, setFamilyPositions } from '../../services/appraisalTemplates.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Appraising staff with a form, end to end: the schedule creates it for the
// month; the staff member's own supervisor scores it; the principal signs it off (or sends
// it back); the staff member reads and confirms. Real handlers, test DB.

const NOW = new Date('2026-11-01T00:00:00Z');
const HR = { id: 'u-hr', email: 'hr@kindertech.test', role: 'ADMIN', teacherId: null };
const SAM = { id: 'u-sam', email: 'sam@kindertech.test', role: 'USER', teacherId: 't-sam' };   // Supervisor — Tina reports to Sam
const PAT = { id: 'u-pat', email: 'pat@kindertech.test', role: 'USER', teacherId: 't-pat' };   // Principal
const TINA = { id: 'u-tina', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-tina' }; // Junior EI — being appraised
const OLI = { id: 'u-oli', email: 'oli@kindertech.test', role: 'USER', teacherId: 't-oli' };   // another supervisor, not Tina's
type Caller = typeof HR;

const call = async (handler: (rq: any, rs: any) => Promise<void>, user: Caller, params: Record<string, string> = {}, body: unknown = {}, query: Record<string, string> = {}) => {
  const r = res();
  const req = reqWith({ params, body, user }) as any;
  req.query = query;
  await handler(req, r);
  return r;
};
const staff = (id: string, name: string, positionId: string, reportsToTeacherId: string | null = null) =>
  ({ id, name, color: '#7c3aed', positionId, reportsToTeacherId, createdAt: NOW, updatedAt: NOW });

let familyId = '';

beforeEach(async () => {
  await resetTables(appraisalLogs, appraisalScores, appraisals, appraisalAssignments, appraisalStagePositions, appraisalStages, appraisalCriterionPoints,
    appraisalCriteria, appraisalSections, appraisalTemplates, teacherAppraisals, teachers, positions, users);
  await db.insert(positions).values([
    { positionId: 'EI', name: 'Junior EI', createdAt: NOW, updatedAt: NOW },
    { positionId: 'SUP', name: 'Supervisor', createdAt: NOW, updatedAt: NOW },
    { positionId: 'PRIN', name: 'Principal', createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(teachers).values([
    staff('t-tina', 'Tina', 'EI', 't-sam'), staff('t-sam', 'Sam', 'SUP'), staff('t-oli', 'Oli', 'SUP'), staff('t-pat', 'Pat', 'PRIN'),
  ]);
  await db.insert(users).values([
    await activeUser({ id: HR.id, email: HR.email, name: 'Hana HR' }),
    await activeUser({ id: SAM.id, email: SAM.email, name: 'Sam Supervisor', role: 'USER', teacherId: 't-sam' }),
    await activeUser({ id: PAT.id, email: PAT.email, name: 'Pat Principal', role: 'USER', teacherId: 't-pat' }),
    await activeUser({ id: TINA.id, email: TINA.email, name: 'Tina Teacher', role: 'USER', teacherId: 't-tina' }),
    await activeUser({ id: OLI.id, email: OLI.email, name: 'Oli Other', role: 'USER', teacherId: 't-oli' }),
  ]);
  // Monthly form for Junior EIs: Love (rating 1–5) 50% + Calm (yes/no) 50%; Supervisor (own team) scores,
  // Principal signs off, the staff member confirms.
  const id = await createTemplate({
    name: 'Monthly EI appraisal', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
    sections: [{ name: 'Care', weight: 100, criteria: [
      { name: 'Love', description: null, weight: 50, inputType: 'RATING', scaleConfig: { max: 5, levels: [] }, points: [] },
      { name: 'Calm', description: null, weight: 50, inputType: 'YES_NO', scaleConfig: null, points: [] },
    ] }],
    stages: [
      { name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] },
      { name: 'Signed off by', kind: 'SIGN_OFF', scope: 'ANYONE', positionIds: ['PRIN'] },
      { name: 'Acknowledged', kind: 'ACKNOWLEDGE', scope: 'ANYONE', positionIds: [] },
    ],
  });
  familyId = id;
  await setFamilyPositions(id, ['EI']);
  await activateTemplate(id);
});
afterAll(async () => { await pool.end(); });

const start = async () => ((await createRun('t-tina', familyId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER)) as { id: string }).id;
const criteria = async () => {
  const love = (await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Love')))[0].id;
  const calm = (await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Calm')))[0].id;
  return { love, calm };
};

describe('Appraisals with a form — the whole way through', () => {
  it('is scored by their supervisor, signed off, confirmed by the staff member, and written into the monthly score', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    // Before sign-off the staff member can't see it.
    expect((await call(getAppraisalRun, TINA, { id })).statusCode).toBe(403);
    // Sam (Tina reports to Sam) scores it: 4 of 5 = 80, yes = 100 → 90.
    const saved = await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 4 }, { criterionId: calm, rawValue: 1 }], comments: 'Great month' });
    expect(saved.body.workingTotal).toBe(90);
    expect((await call(submitAppraisalRun, SAM, { id })).body).toMatchObject({ status: 'AWAITING_SIGN_OFF', totalScore: 90 });
    // HRMS → Appraisals files it by step: sign-off → staff to confirm → done.
    const stage = async () => (await runsCovering(2026, 10))[0].stage;
    expect(await stage()).toBe('SIGN_OFF');
    // Pat signs it off → Tina confirms → done.
    expect((await call(approveAppraisalRun, PAT, { id })).body.status).toBe('AWAITING_ACKNOWLEDGEMENT');
    expect(await stage()).toBe('CONFIRM');
    expect((await call(getAppraisalRun, TINA, { id })).body.can.acknowledge).toBe(true);
    expect((await call(acknowledgeAppraisalRun, TINA, { id })).body.status).toBe('COMPLETED');
    expect(await stage()).toBe('DONE');
    const [month] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.teacherId, 't-tina'));
    expect(month).toMatchObject({ year: 2026, month: 10, score: 90, notes: 'Great month', evaluatedBy: 'Sam Supervisor', engineAppraisalId: id });
    const log = (await call(getAppraisalRun, HR, { id })).body.log.map((l: any) => l.kind);
    expect(log).toEqual(['STARTED', 'SUBMITTED', 'SIGNED_OFF', 'ACKNOWLEDGED']);
  });

  it('keeps a month scored with a form as the form worked it out — HR can\'t overwrite or delete it by hand', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 4 }, { criterionId: calm, rawValue: 1 }] });
    await call(submitAppraisalRun, SAM, { id });
    await call(approveAppraisalRun, PAT, { id });
    await call(acknowledgeAppraisalRun, TINA, { id });
    const [month] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.teacherId, 't-tina'));
    const edit = await call(upsertAppraisal, HR, { teacherId: 't-tina' }, { year: 2026, month: 10, score: 40 });
    expect(edit.statusCode).toBe(409);
    expect(edit.body.message).toBe(FROM_FORM_MESSAGE);
    expect((await call(deleteAppraisal, HR, { id: month.id })).statusCode).toBe(409);
    expect((await db.select().from(teacherAppraisals))[0].score).toBe(90);
  });

  it('says it is their own only to the staff member — not to the supervisor scoring it or the principal signing it off', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    expect((await call(getAppraisalRun, SAM, { id })).body.mine).toBe(false);
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 4 }, { criterionId: calm, rawValue: 1 }] });
    await call(submitAppraisalRun, SAM, { id });
    expect((await call(getAppraisalRun, PAT, { id })).body.mine).toBe(false);
    await call(approveAppraisalRun, PAT, { id });
    expect((await call(getAppraisalRun, TINA, { id })).body.mine).toBe(true);
    expect((await call(getAppraisalRun, HR, { id })).body.mine).toBe(false);
  });

  it('only lets the right people act: not another supervisor, not the staff member on their own, not out of turn', async () => {
    const id = await start();
    const { love } = await criteria();
    expect((await call(getAppraisalRun, OLI, { id })).statusCode).toBe(403); // Oli isn't Tina's supervisor
    expect((await call(saveAppraisalRunScores, OLI, { id }, { scores: [{ criterionId: love, rawValue: 4 }] })).statusCode).toBe(403);
    expect((await call(saveAppraisalRunScores, TINA, { id }, { scores: [{ criterionId: love, rawValue: 5 }] })).statusCode).toBe(403);
    expect((await call(approveAppraisalRun, PAT, { id })).statusCode).toBe(403); // nothing to sign off yet
    // Someone outside HR asking about an appraisal that doesn't exist is simply refused.
    expect((await call(approveAppraisalRun, OLI, { id: 'nope' })).statusCode).toBe(403);
  });

  it('refuses values that don\'t fit, and won\'t submit until everything is scored', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    expect((await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 6 }] })).body.message).toBe('"Love" is rated 1 to 5.');
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 4 }] });
    const r = await call(submitAppraisalRun, SAM, { id });
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toBe('Score everything first — still to do: Calm.');
    void calm;
  });

  it('keeps a comment on each scored item, and one on an item not scored yet', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [
      { criterionId: love, rawValue: 4, comment: 'Warm with every child' },
      { criterionId: calm, rawValue: null, comment: 'Watch this next month' },
    ] });
    const scores = (await call(getAppraisalRun, SAM, { id })).body.scores;
    expect(scores.find((s: any) => s.criterionId === love)).toMatchObject({ rawValue: 4, comment: 'Warm with every child' });
    expect(scores.find((s: any) => s.criterionId === calm)).toMatchObject({ rawValue: null, comment: 'Watch this next month' });
  });

  it('can be sent back with a reason, rescored and resubmitted', async () => {
    const id = await start();
    const { love, calm } = await criteria();
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 2 }, { criterionId: calm, rawValue: 0 }] });
    await call(submitAppraisalRun, SAM, { id });
    const back = await call(sendBackAppraisalRun, PAT, { id }, { reason: 'Love looks too low — check the notes' });
    expect(back.body.status).toBe('SENT_BACK');
    expect((await call(getMyAppraisalTasks, SAM)).body.map((t: any) => [t.teacherName, t.todo])).toEqual([['Tina', 'SCORE']]);
    await call(saveAppraisalRunScores, SAM, { id }, { scores: [{ criterionId: love, rawValue: 5 }, { criterionId: calm, rawValue: 0 }] });
    expect((await call(submitAppraisalRun, SAM, { id })).body).toMatchObject({ status: 'AWAITING_SIGN_OFF', totalScore: 50 });
  });
});

describe('Appraisals with a form — cancelling, and criteria scored from a scoring form', () => {
  it('lets HR cancel an unfinished appraisal, but keeps a completed one for good', async () => {
    const id = await start();
    expect((await call(cancelAppraisalRun, HR, { id })).statusCode).toBe(204);
    expect(await db.select().from(appraisals)).toHaveLength(0);
  });

  it('saves a score for each criterion of a copied scoring form, and scores it as that form\'s total', async () => {
    // A second live form whose one criterion is scored from a scoring form: Patience (1–4) 50% + Calm (yes/no) 50%.
    const formId = await createTemplate({
      name: 'With a scoring form', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
      sections: [{ name: 'Care', weight: 100, criteria: [
        { name: 'Classroom care', description: null, weight: 100, inputType: 'FORM', points: [], scaleConfig: { scoringFormId: 'sf', name: 'Care', sections: [
          { name: 'Care', weight: 100, criteria: [
            { name: 'Patience', weight: 50, inputType: 'RATING', scaleConfig: { max: 4 } },
            { name: 'Calm', weight: 50, inputType: 'YES_NO', scaleConfig: null },
          ] },
        ] } },
      ] }],
      stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] }],
    });
    await setFamilyPositions(formId, ['PRIN']); // who it's for is a hint only — a form can be scheduled for anyone
    expect(await activateTemplate(formId)).toBe('ok');
    const made = await createRun('t-tina', formId, 'MONTHLY', { year: 2026, month: 10 }, SCHEDULER) as { id: string };
    const [care] = await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Classroom care'));
    const saved = await call(saveAppraisalRunScores, SAM, { id: made.id }, { scores: [
      { criterionId: care.id, pointId: 'f:0:0', rawValue: 2 }, // 2 of 4 = 50
      { criterionId: care.id, pointId: 'f:0:1', rawValue: 1 }, // yes = 100
    ] });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.workingTotal).toBe(75);
    expect(await db.select().from(appraisalScores)).toHaveLength(2);
  });
});

describe('Appraisals with a form — who signs off, and a second one in a month', () => {
  // The supervisor both scores and signs off on this form.
  const supervisorSignsOff = async () => {
    const id = await createTemplate({
      name: 'Supervisor signs off', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
      sections: [{ name: 'Care', weight: 100, criteria: [{ name: 'Kindness', description: null, weight: 100, inputType: 'RATING', scaleConfig: { max: 5, levels: [] }, points: [] }] }],
      stages: [
        { name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] },
        { name: 'Signed off by', kind: 'SIGN_OFF', scope: 'ANYONE', positionIds: ['SUP'] },
        { name: 'Acknowledged', kind: 'ACKNOWLEDGE', scope: 'ANYONE', positionIds: [] },
      ],
    });
    await setFamilyPositions(id, ['PRIN']);
    await activateTemplate(id);
    const made = await createRun('t-tina', id, 'MONTHLY', { year: 2026, month: 9 }, SCHEDULER) as { id: string };
    const [k] = await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Kindness'));
    await call(saveAppraisalRunScores, SAM, { id: made.id }, { scores: [{ criterionId: k.id, rawValue: 4 }] });
    await call(submitAppraisalRun, SAM, { id: made.id });
    return made.id;
  };

  it('lets the scorer sign off only when no one is above them in the reporting line', async () => {
    await db.update(teachers).set({ reportsToTeacherId: 't-pat' }).where(eq(teachers.id, 't-sam'));
    const id = await supervisorSignsOff();
    const refused = await call(approveAppraisalRun, SAM, { id });
    expect(refused.statusCode).toBe(403);
    expect(refused.body.message).toMatch(/someone above you/);
    expect((await call(getAppraisalRun, SAM, { id })).body.signOffBySomeoneAbove).toBe(true);
    // Sam at the top (reports to no one): he signs off his own scoring.
    await db.update(teachers).set({ reportsToTeacherId: null }).where(eq(teachers.id, 't-sam'));
    expect((await call(approveAppraisalRun, SAM, { id })).body.status).toBe('AWAITING_ACKNOWLEDGEMENT');
  });

  it('never lets anyone score or sign off their own appraisal — not even an admin', async () => {
    const id = await start();
    const ADMIN_TINA = { ...TINA, role: 'ADMIN' };
    const { love } = await criteria();
    expect((await call(saveAppraisalRunScores, ADMIN_TINA, { id }, { scores: [{ criterionId: love, rawValue: 5 }] })).statusCode).toBe(403);
  });

  it('warns before a second appraisal in the same month, makes it when asked, and scores the month as their average', async () => {
    const first = await start(); // Monthly EI appraisal, Nov 2026
    const { love, calm } = await criteria();
    await call(saveAppraisalRunScores, SAM, { id: first }, { scores: [{ criterionId: love, rawValue: 4 }, { criterionId: calm, rawValue: 1 }] }); // 90
    await call(submitAppraisalRun, SAM, { id: first });
    await call(approveAppraisalRun, PAT, { id: first });
    await call(acknowledgeAppraisalRun, TINA, { id: first });
    const other = await createTemplate({
      name: 'Second form', description: null, frequency: 'MONTHLY', missingPolicy: 'REQUIRE_ALL',
      sections: [{ name: 'Care', weight: 100, criteria: [{ name: 'Gentle', description: null, weight: 100, inputType: 'YES_NO', scaleConfig: null, points: [] }] }],
      stages: [{ name: 'Assessed by', kind: 'ASSESS', scope: 'OWN_TEAM', positionIds: ['SUP'] }],
    });
    await setFamilyPositions(familyId, ['PRIN']); // a position uses one form at a time — hand Junior EI to the second
    await setFamilyPositions(other, ['EI']);
    await activateTemplate(other);
    const warned = await startOneOff('t-tina', other, { year: 2026, month: 10 }, SCHEDULER);
    expect(warned).toMatchObject({ status: 409 });
    expect((warned as { error: string }).error).toContain('already has an appraisal for November 2026 (Monthly EI appraisal)');
    const second = await startOneOff('t-tina', other, { year: 2026, month: 10 }, SCHEDULER, undefined, true) as { id: string };
    expect(second.id).toBeTruthy();
    const [g] = await db.select().from(appraisalCriteria).where(eq(appraisalCriteria.name, 'Gentle'));
    await call(saveAppraisalRunScores, SAM, { id: second.id }, { scores: [{ criterionId: g.id, rawValue: 0 }] }); // no = 0
    expect((await call(submitAppraisalRun, SAM, { id: second.id })).body.status).toBe('COMPLETED');
    const [month] = await db.select().from(teacherAppraisals).where(eq(teacherAppraisals.teacherId, 't-tina'));
    expect(month.score).toBe(45); // (90 + 0) / 2
  });
});
