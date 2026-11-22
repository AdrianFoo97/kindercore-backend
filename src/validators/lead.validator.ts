import { z } from 'zod';

const currentYear = new Date().getFullYear();

/** Fits the database columns (varchar 191) — longer is refused, never cut. */
const SHORT_TEXT_MAX = 191;
/** Room for a real note; a bot pasting 200 KB of junk is refused. */
const NOTES_MAX = 5000;
/** The ctaSource column is varchar(50). */
const CTA_SOURCE_MAX = 50;
const short = () => z.string().min(1).max(SHORT_TEXT_MAX);

export const createLeadSchema = z.object({
  childName: short(),
  parentPhone: short(),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
  enrolmentYear: z.number().int().min(2020).max(currentYear + 6),
  company: z.string().max(0, 'Honeypot triggered').optional(),
  relationship: short().optional(),
  programme: short().optional(),
  preferredAppointmentTime: short().optional(),
  addressLocation: short().optional(),
  needsTransport: z.boolean().optional(),
  howDidYouKnow: short().optional(),
  ctaSource: z.string().max(CTA_SOURCE_MAX).optional(),
  utmSource: z.string().max(SHORT_TEXT_MAX).optional(),
  promoCode: z.string().max(50).optional(),
  submittedAt: z.string().optional(),
  // Public enquiry form embeds the referrer's child name in `notes` as
  // `朋友介绍 — 朋友的孩子：{name}，请确认...` so the leads table can
  // surface who connected each Friend Referral lead. Without this entry
  // the Zod validator strips the field before it reaches the DB.
  notes: z.string().max(NOTES_MAX).optional(),
});

export const updateLeadSchema = z.object({
  childName: z.string().min(1).optional(),
  parentPhone: z.string().min(1).optional(),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  enrolmentYear: z.number().int().min(2020).max(currentYear + 5).optional(),
  status: z
    .enum(['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST', 'REJECTED'])
    .optional(),
  notes: z.string().optional(),
  lostReason: z.string().nullable().optional(),
  relationship: z.string().min(1).nullable().optional(),
  programme: z.string().min(1).nullable().optional(),
  preferredAppointmentTime: z.string().min(1).nullable().optional(),
  addressLocation: z.string().min(1).nullable().optional(),
  needsTransport: z.boolean().nullable().optional(),
  howDidYouKnow: z.string().min(1).nullable().optional(),
  appointmentStart: z.string().nullable().optional(),
  appointmentEnd: z.string().nullable().optional(),
  statusChangedAt: z.string().nullable().optional(),
  attended: z.boolean().optional(),
}).refine(
  // A lead marked LOST or REJECTED must carry a reason — it's what drives
  // the Lead Quality KPI and the Unqualified tooltip in analytics. The UI
  // already blocks the transition; this is the backend safety net.
  data => {
    if (data.status !== 'LOST' && data.status !== 'REJECTED') return true;
    return typeof data.lostReason === 'string' && data.lostReason.trim().length > 0;
  },
  { message: 'A reason is required when marking a lead as Lost or Rejected.', path: ['lostReason'] },
);
