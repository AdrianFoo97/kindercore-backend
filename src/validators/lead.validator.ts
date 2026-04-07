import { z } from 'zod';

const currentYear = new Date().getFullYear();

export const createLeadSchema = z.object({
  childName: z.string().min(1),
  parentPhone: z.string().min(1),
  childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
  enrolmentYear: z.number().int().min(2020).max(currentYear + 6),
  company: z.string().max(0, 'Honeypot triggered').optional(),
  relationship: z.string().min(1).optional(),
  programme: z.string().min(1).optional(),
  preferredAppointmentTime: z.string().min(1).optional(),
  addressLocation: z.string().min(1).optional(),
  needsTransport: z.boolean().optional(),
  howDidYouKnow: z.string().min(1).optional(),
  ctaSource: z.string().optional(),
  utmSource: z.string().optional(),
  submittedAt: z.string().optional(),
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
});
