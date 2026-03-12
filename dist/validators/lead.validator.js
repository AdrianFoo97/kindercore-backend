import { z } from 'zod';
const currentYear = new Date().getFullYear();
export const createLeadSchema = z.object({
    childName: z.string().min(1),
    parentPhone: z.string().min(1),
    childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
    enrolmentYear: z.number().int().min(currentYear).max(currentYear + 6),
    company: z.string().max(0, 'Honeypot triggered').optional(),
    relationship: z.string().min(1).optional(),
    programme: z.string().min(1).optional(),
    preferredAppointmentTime: z.string().min(1).optional(),
    addressLocation: z.string().min(1).optional(),
    needsTransport: z.boolean().optional(),
    howDidYouKnow: z.string().min(1).optional(),
});
export const updateLeadSchema = z.object({
    childName: z.string().min(1).optional(),
    parentPhone: z.string().min(1).optional(),
    childDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    enrolmentYear: z.number().int().min(2020).max(currentYear + 5).optional(),
    status: z
        .enum(['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST'])
        .optional(),
    notes: z.string().optional(),
    lostReason: z.string().nullable().optional(),
});
//# sourceMappingURL=lead.validator.js.map