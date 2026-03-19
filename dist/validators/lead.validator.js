"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLeadSchema = exports.createLeadSchema = void 0;
const zod_1 = require("zod");
const currentYear = new Date().getFullYear();
exports.createLeadSchema = zod_1.z.object({
    childName: zod_1.z.string().min(1),
    parentPhone: zod_1.z.string().min(1),
    childDob: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD)'),
    enrolmentYear: zod_1.z.number().int().min(2020).max(currentYear + 6),
    company: zod_1.z.string().max(0, 'Honeypot triggered').optional(),
    relationship: zod_1.z.string().min(1).optional(),
    programme: zod_1.z.string().min(1).optional(),
    preferredAppointmentTime: zod_1.z.string().min(1).optional(),
    addressLocation: zod_1.z.string().min(1).optional(),
    needsTransport: zod_1.z.boolean().optional(),
    howDidYouKnow: zod_1.z.string().min(1).optional(),
    submittedAt: zod_1.z.string().optional(),
});
exports.updateLeadSchema = zod_1.z.object({
    childName: zod_1.z.string().min(1).optional(),
    parentPhone: zod_1.z.string().min(1).optional(),
    childDob: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    enrolmentYear: zod_1.z.number().int().min(2020).max(currentYear + 5).optional(),
    status: zod_1.z
        .enum(['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST'])
        .optional(),
    notes: zod_1.z.string().optional(),
    lostReason: zod_1.z.string().nullable().optional(),
    relationship: zod_1.z.string().min(1).nullable().optional(),
    programme: zod_1.z.string().min(1).nullable().optional(),
    preferredAppointmentTime: zod_1.z.string().min(1).nullable().optional(),
    addressLocation: zod_1.z.string().min(1).nullable().optional(),
    needsTransport: zod_1.z.boolean().nullable().optional(),
    howDidYouKnow: zod_1.z.string().min(1).nullable().optional(),
});
//# sourceMappingURL=lead.validator.js.map