import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const isoOrDateString = z.string().min(1);

const commuteEnum = z.enum([
  'UNDER_15', 'MIN_15_30', 'MIN_30_45', 'MIN_45_60', 'OVER_60', 'WILL_MOVE',
]);

// All fields except `notes` are required. Frontend gates the Submit
// button on the same set; this schema is the safety net for
// hand-crafted POSTs. `qualificationOther` is conditionally required
// via .refine() when the candidate picks the "Others" bucket.
export const createCandidateSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  dob: dateString,
  addressLocation: z.string().min(1),
  commuteTime: commuteEnum,
  availableFrom: dateString,
  preferredStartDate: dateString,
  desiredPosition: z.string().min(1),
  experienceRange: z.string().min(1),
  qualification: z.string().min(1),
  qualificationOther: z.string().min(1).optional(),
  expectedSalary: z.number().min(0),
  /** Upper bound when the applicant gave a range. Optional across
   *  all channels — only meaningful when > expectedSalary. */
  expectedSalaryMax: z.number().min(0).optional(),
  salaryJustification: z.string().min(1),
  careerGoals: z.string().min(1),
  whyKindergartenTeacher: z.string().min(1),
  howDidYouKnow: z.string().min(1),
  /** The only optional free-text field on the form. */
  notes: z.string().optional(),
  /** Which channel the application came through. Native /apply omits
   *  this (server defaults to 'apply_form'); the Google Form → Apps
   *  Script bridge sets 'google_form'; the admin bulk import endpoint
   *  sets 'imported'. */
  submissionSource: z.enum(['apply_form', 'google_form', 'imported']).optional(),
  /** utm_source parameter from the apply URL — the job-board / channel
   *  the applicant clicked from. e.g. 'jobstreet', 'indeed', 'maukerja'. */
  utmSource: z.string().max(191).optional(),
  /** External resume URL — populated by the Apps Script bridge when
   *  the applicant uploaded a resume through Google Forms (lives in
   *  Drive). Ignored by the public /apply flow which uses a separate
   *  file-upload endpoint. */
  resumeUrl: z.string().url().optional(),
  /** Pipeline status — only accepted from the admin import path so
   *  historical rows can land already-triaged. The public /apply flow
   *  and Google Form bridge should NOT set this; server defaults to
   *  'NEW' when omitted. */
  status: z.enum(['NEW', 'CONTACTED', 'INTERVIEWING', 'PENDING_DECISION', 'OFFER_SENT', 'HIRED', 'REJECTED', 'TALENT_BANK']).optional(),
  /** Free-text reason paired with a REJECTED status. Also import-only. */
  rejectionReason: z.string().optional(),
  /** Original submission timestamp — only meaningful from the admin
   *  import path so historical rows land with their real
   *  chronological order. Accepts anything Date() can parse (ISO,
   *  M/D/YYYY H:MM:SS, etc.). Public /apply always sets `now`. */
  submittedAt: z.string().optional(),
  /** Interview appointment datetime — populated from the import path
   *  when the source sheet has an "Appointment" column. Any date form
   *  Date() can parse is accepted. Absence means no interview was
   *  scheduled. Pairs with a status of INTERVIEWING (the importer
   *  auto-promotes rows carrying a value here). */
  interviewStart: z.string().optional(),
  /** Public-form honeypot — bots fill this; legit users don't. */
  company: z.string().max(0, 'Honeypot triggered').optional(),
}).refine(
  data => data.qualification.toLowerCase() !== 'others'
       || (typeof data.qualificationOther === 'string' && data.qualificationOther.trim().length > 0),
  { message: 'Please describe your qualification.', path: ['qualificationOther'] },
).refine(
  // Applicants must be at least 18 when submitting via the public
  // /apply flow. The Google Form bridge (submissionSource: 'google_form')
  // is an admin-controlled intake channel — we'd rather have the row
  // land and let the admin decide what to do with an under-age
  // applicant than silently reject the submission and lose the data.
  data => {
    if (data.submissionSource === 'google_form' || data.submissionSource === 'imported') return true;
    const dob = new Date(data.dob);
    if (isNaN(dob.getTime())) return true; // let the earlier regex catch bad formats
    const eighteenAgo = new Date();
    eighteenAgo.setFullYear(eighteenAgo.getFullYear() - 18);
    return dob <= eighteenAgo;
  },
  { message: 'Applicants must be at least 18 years old.', path: ['dob'] },
).refine(
  // Earliest start date can't be in the past. Same rationale as
  // above — enforced for the public form, relaxed for the Google
  // Form bridge so back-dated / same-day submissions still land.
  data => {
    if (data.submissionSource === 'google_form' || data.submissionSource === 'imported') return true;
    const d = new Date(data.availableFrom);
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  },
  { message: "Earliest start date can't be in the past.", path: ['availableFrom'] },
).refine(
  data => {
    if (data.submissionSource === 'google_form' || data.submissionSource === 'imported') return true;
    const d = new Date(data.preferredStartDate);
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  },
  { message: "Preferred start date can't be in the past.", path: ['preferredStartDate'] },
);

// "Accepted" on an OFFER_SENT candidate — confirms the hire details and
// creates the Teacher record in one step. Deliberately stricter than
// createTeacherSchema (which allows a mostly-empty teacher row): every
// payroll-relevant field must be a real, non-placeholder value so a hire
// never produces a half-configured teacher.
export const hireCandidateSchema = z.object({
  phone: z.string().min(1),
  positionId: z.string().min(1),
  level: z.number().int().min(0).max(10).default(0),
  employmentType: z.enum(['full-time', 'part-time']),
  joinDate: dateString,
  salaryType: z.enum(['formula', 'fixed', 'hourly']),
  fixedSalaryAmount: z.number().min(0).optional(),
  hourlyRate: z.number().min(0).optional(),
  hasEpf: z.boolean(),
  hasSocso: z.boolean(),
  hasEis: z.boolean(),
  /** Work schedule — same fields Teacher/EditTeacherPage's Operations tab
   *  uses. Optional: an admin can leave it for later, but it's what
   *  makes an Hourly salaryType's monthly total computable at all. */
  workStartMinute: z.number().int().min(0).max(1440).optional(),
  workEndMinute: z.number().int().min(0).max(1440).optional(),
  workDays: z.array(z.number().int().min(0).max(4)).optional(),
  /** Per-type allowance amounts (Attendance, KPI, Other Allowance and its
   *  children, any custom types the admin has added) — same set EditTeacherPage
   *  exposes. Zero/omitted entries are simply not stored as TeacherAllowance rows. */
  allowances: z.array(z.object({
    allowanceTypeId: z.string().min(1),
    amount: z.number().min(0),
  })).optional(),
}).refine(
  data => data.salaryType !== 'fixed' || (typeof data.fixedSalaryAmount === 'number' && data.fixedSalaryAmount > 0),
  { message: 'Enter a fixed salary amount.', path: ['fixedSalaryAmount'] },
).refine(
  data => data.salaryType !== 'hourly' || (typeof data.hourlyRate === 'number' && data.hourlyRate > 0),
  { message: 'Enter an hourly rate.', path: ['hourlyRate'] },
);

export const updateCandidateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  careerGoals: z.string().min(1).nullable().optional(),
  whyKindergartenTeacher: z.string().min(1).nullable().optional(),
  salaryJustification: z.string().nullable().optional(),
  dob: dateString.nullable().optional(),
  addressLocation: z.string().min(1).nullable().optional(),
  commuteTime: commuteEnum.nullable().optional(),
  desiredPosition: z.string().min(1).nullable().optional(),
  expectedSalary: z.number().min(0).nullable().optional(),
  availableFrom: dateString.nullable().optional(),
  preferredStartDate: dateString.nullable().optional(),
  experienceRange: z.string().min(1).nullable().optional(),
  qualification: z.string().min(1).nullable().optional(),
  qualificationOther: z.string().min(1).nullable().optional(),
  howDidYouKnow: z.string().min(1).nullable().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'INTERVIEWING', 'PENDING_DECISION', 'OFFER_SENT', 'HIRED', 'REJECTED', 'TALENT_BANK']).optional(),
  isShortlisted: z.boolean().optional(),
  statusChangedAt: isoOrDateString.nullable().optional(),
  interviewStart: isoOrDateString.nullable().optional(),
  interviewEnd: isoOrDateString.nullable().optional(),
  interviewLocation: z.string().min(1).nullable().optional(),
  interviewNotes: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  hiredAt: isoOrDateString.nullable().optional(),
  notes: z.string().nullable().optional(),
  adminNotes: z.string().nullable().optional(),
}).refine(
  // A REJECTED candidate must carry a reason — symmetrical to the leads rule
  // so the rejection log stays meaningful for hiring retros.
  data => {
    if (data.status !== 'REJECTED') return true;
    return typeof data.rejectionReason === 'string' && data.rejectionReason.trim().length > 0;
  },
  { message: 'A reason is required when rejecting a candidate.', path: ['rejectionReason'] },
);
