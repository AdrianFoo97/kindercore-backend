import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_EVENTS, appraisalSignOffMessage, grantsAudience, notificationSettings, bugReportedMessage, facilityMessage, guideSuggestedMessage, incidentMessage,
  itemRequestedMessage, newApplicationMessage, newLeadMessage, newStaffJoinMessage, onboardingSelfDoneMessage,
  costsRecordedMessage, itemBoughtMessage, mayReceive, newStudentMessage, studentWithdrawnMessage,
  myAppraisalMessage, myPointsMessage, myReportMessage, myRequestMessage, myRewardMessage,
} from '../../services/notifications.logic.js';

describe('Notifications — what each one says and where it opens', () => {
  it('opens the lead, the applicant, the approval queue or the incident', () => {
    expect(newLeadMessage({ id: 'l1', childName: 'Aisha', programme: 'Full Day' }))
      .toEqual({ kind: 'NEW_LEAD', title: 'New lead: Aisha', body: 'Enquiry for Full Day', link: '/leads?edit=l1' });
    expect(newApplicationMessage({ id: 'c1', fullName: 'Siti Aminah', desiredPosition: 'Assistant Teacher' }).link).toBe('/hr/candidates?candidate=c1');
    expect(newStaffJoinMessage({ fullName: 'Lim Wei' })).toMatchObject({ title: 'New staff joining: Lim Wei', body: 'Waiting for your approval', link: '/hr/new-staff' });
    expect(incidentMessage({ id: 'i1', location: 'Playground', reportedByName: 'Tina' })).toMatchObject({ body: 'Playground · reported by Tina', link: '/operations/incidents/i1' });
  });

  it('keeps titles within what the database holds', () => {
    expect(newLeadMessage({ id: 'l1', childName: 'x'.repeat(400) }).title.length).toBeLessThanOrEqual(191);
  });

  it('opens the right place for appraisals, onboarding, facilities, the shopping list, guide reviews and bugs', () => {
    expect(appraisalSignOffMessage({ id: 'a1', teacherName: 'Tina', formName: 'Monthly EI', scoredByName: 'Sam' }))
      .toMatchObject({ title: 'Appraisal ready for sign-off: Tina', body: 'Monthly EI · scored by Sam', link: '/appraisals/a1' });
    expect(onboardingSelfDoneMessage({ name: 'Tina' }).link).toBe('/hr/onboarding');
    expect(facilityMessage({ title: 'Door won’t lock', location: 'Toilet', reportedByName: 'Tina' }).link).toBe('/operations/facilities');
    expect(itemRequestedMessage({ item: 'Glue sticks', quantity: 10, requestedByName: 'Tina' }).title).toBe('Item requested: Glue sticks × 10');
    expect(guideSuggestedMessage({ id: 'r1', title: 'Pick-up', byName: 'Tina', isNewGuide: false }).title).toBe('Guide change suggested: Pick-up');
    expect(guideSuggestedMessage({ id: 'r1', title: 'Pick-up', byName: 'Tina', isNewGuide: false, resubmitted: true }).link).toBe('/hr/sop-revisions/r1');
    expect(bugReportedMessage({ title: 'Save does nothing', reportedByName: 'Tina' }).link).toBe('/tools/bug-reports');
  });

  it('lists every event once, each under a category, for Settings → Notifications', () => {
    const kinds = NOTIFICATION_EVENTS.map(e => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(NOTIFICATION_EVENTS.every(e => e.category && e.label && e.description)).toBe(true);
  });

  it('lets a role receive an event only with one of its modules — and the function, when the page needs one', () => {
    expect(grantsAudience({ modules: ['MARKETING'], functions: [] }, { anyOf: [{ module: 'MARKETING' }] })).toBe(true);
    expect(grantsAudience({ modules: ['OPERATION'], functions: [] }, { anyOf: [{ module: 'HR' }, { module: 'OPERATION' }] })).toBe(true);
    expect(grantsAudience({ modules: ['OPERATION'], functions: [] }, { anyOf: [{ module: 'OPERATION', fn: 'OPERATION_INCIDENT_MANAGE' }] })).toBe(false);
    expect(grantsAudience({ modules: ['OPERATION'], functions: ['OPERATION_INCIDENT_MANAGE'] }, { anyOf: [{ module: 'OPERATION', fn: 'OPERATION_INCIDENT_MANAGE' }] })).toBe(true);
  });

  it('offers appraisal sign-off to HR and Operation managers, never to a plain teacher', () => {
    const teacher = { modules: ['OPERATION'], functions: [] };
    const supervisor = { modules: ['OPERATION'], functions: ['OPERATION_SOP_APPROVE'] };
    expect(mayReceive('APPRAISAL_SIGN_OFF', [teacher], false, true)).toBe(false);
    expect(mayReceive('APPRAISAL_SIGN_OFF', [supervisor], false, true)).toBe(true);
    expect(mayReceive('APPRAISAL_SIGN_OFF', [{ modules: ['HR'], functions: [] }], false, true)).toBe(true);
    expect(mayReceive('APPRAISAL_SIGN_OFF', [], true, true)).toBe(true);
  });

  it('opens the student, operating costs or the cost report for the Students, Finance and Analysis events', () => {
    expect(newStudentMessage({ id: 's1', childName: 'Aisha' })).toMatchObject({ title: 'New student: Aisha', link: '/students/s1' });
    expect(studentWithdrawnMessage({ id: 's1', childName: 'Aisha', reason: 'Moving away' })).toMatchObject({ body: 'Moving away', link: '/students/s1' });
    expect(itemBoughtMessage({ item: 'Glue', quantity: 2, cost: '12.50' })).toMatchObject({ title: 'Bought: Glue × 2 — RM 12.50', link: '/operations/operating-costs' });
    expect(costsRecordedMessage({ year: 2026, month: 10 })).toMatchObject({ title: 'Operating costs recorded: October 2026', link: '/analysis/operating-cost' });
  });

  it('offers the “about you” notifications to every staff member, whatever their roles — and to no one without a staff record', () => {
    const personal = ['MY_REQUEST_UPDATE', 'MY_REPORT_UPDATE', 'MY_APPRAISAL_READY', 'MY_POINTS', 'MY_REWARD_DELIVERED'];
    const teacher = notificationSettings([{ name: 'Teacher', modules: ['OPERATION'], functions: [] }], false, [], true);
    expect(teacher.map(e => e.kind)).toEqual(personal);
    expect(teacher.every(e => e.from[0] === 'Your own work')).toBe(true);
    expect(notificationSettings([], true, [], false).some(e => personal.includes(e.kind))).toBe(false);
    expect(mayReceive('MY_POINTS', [], false, true)).toBe(true);
    expect(mayReceive('MY_POINTS', [], true, false)).toBe(false);
  });

  it('opens your own requests, reports, appraisal and rewards', () => {
    expect(myRequestMessage({ teacherId: 't1', item: 'Glue', quantity: 2, outcome: 'NOT_BUYING', reason: 'We have some' }))
      .toEqual({ kind: 'MY_REQUEST_UPDATE', title: 'Not buying: Glue × 2', body: 'We have some', link: '/teachers/t1/purchases' });
    expect(myReportMessage({ teacherId: 't1', what: 'facility', place: 'Door · Toilet', status: 'RESOLVED' }))
      .toMatchObject({ title: 'Your facility issue: Resolved', link: '/teachers/t1/facilities' });
    expect(myReportMessage({ teacherId: 't1', what: 'incident', place: 'Playground', status: 'PARENT_INFORMED' }).link).toBe('/teachers/t1/incidents');
    expect(myAppraisalMessage({ id: 'a1', formName: 'Monthly' }).link).toBe('/appraisals/a1');
    expect(myPointsMessage({ teacherId: 't1', amount: 1, label: 'Helped out' }).title).toBe('You received 1 point');
    expect(myRewardMessage({ teacherId: 't1', label: 'Lunch voucher' })).toMatchObject({ title: 'Reward delivered: Lunch voucher', link: '/teachers/t1/rewards' });
  });

  it('lists only the events someone’s roles give, naming every role that gives each', () => {
    const roles = [{ name: 'Marketing Executive', modules: ['MARKETING'], functions: [] }, { name: 'Principal', modules: ['MARKETING', 'HR'], functions: ['HR_SEE_ALL_STAFF'] }];
    const shown = notificationSettings(roles, false, ['NEW_APPLICATION']);
    expect(shown.find(e => e.kind === 'NEW_LEAD')).toMatchObject({ from: ['Marketing Executive', 'Principal'], enabled: true });
    expect(shown.find(e => e.kind === 'NEW_APPLICATION')).toMatchObject({ from: ['Principal'], enabled: false });
    expect(shown.some(e => e.kind === 'INCIDENT_REPORTED')).toBe(false);
  });
});
