import { describe, it, expect } from 'vitest';
import { createLeadSchema } from '../../validators/lead.validator.js';

// A complete, valid public-enquiry submission. Each rejection test changes
// exactly one thing from it, so a failure can only be caused by that thing
// (an invalid base payload would make every "rejects…" test pass vacuously).
const valid = {
  childName: 'Alice',
  parentPhone: '0123456789',
  childDob: '2022-03-15',
  enrolmentYear: new Date().getFullYear() + 1,
};

describe('Lead intake validation', () => {
  it('accepts a valid lead submission', () => {
    expect(createLeadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects submission when honeypot field is filled', () => {
    expect(createLeadSchema.safeParse({ ...valid, company: 'Spammer Inc' }).success).toBe(false);
  });

  it('accepts an empty honeypot field', () => {
    expect(createLeadSchema.safeParse({ ...valid, company: '' }).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(createLeadSchema.safeParse({ childName: '' }).success).toBe(false);
  });

  it('rejects a date of birth not in YYYY-MM-DD form', () => {
    expect(createLeadSchema.safeParse({ ...valid, childDob: '15/03/2022' }).success).toBe(false);
  });

  it('rejects an enrolment year before 2020', () => {
    expect(createLeadSchema.safeParse({ ...valid, enrolmentYear: 2019 }).success).toBe(false);
  });
});
