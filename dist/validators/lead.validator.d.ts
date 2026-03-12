import { z } from 'zod';
export declare const createLeadSchema: z.ZodObject<{
    childName: z.ZodString;
    parentPhone: z.ZodString;
    childDob: z.ZodString;
    enrolmentYear: z.ZodNumber;
    company: z.ZodOptional<z.ZodString>;
    relationship: z.ZodOptional<z.ZodString>;
    programme: z.ZodOptional<z.ZodString>;
    preferredAppointmentTime: z.ZodOptional<z.ZodString>;
    addressLocation: z.ZodOptional<z.ZodString>;
    needsTransport: z.ZodOptional<z.ZodBoolean>;
    howDidYouKnow: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    childName?: string;
    parentPhone?: string;
    childDob?: string;
    enrolmentYear?: number;
    company?: string;
    relationship?: string;
    programme?: string;
    preferredAppointmentTime?: string;
    addressLocation?: string;
    needsTransport?: boolean;
    howDidYouKnow?: string;
}, {
    childName?: string;
    parentPhone?: string;
    childDob?: string;
    enrolmentYear?: number;
    company?: string;
    relationship?: string;
    programme?: string;
    preferredAppointmentTime?: string;
    addressLocation?: string;
    needsTransport?: boolean;
    howDidYouKnow?: string;
}>;
export declare const updateLeadSchema: z.ZodObject<{
    childName: z.ZodOptional<z.ZodString>;
    parentPhone: z.ZodOptional<z.ZodString>;
    childDob: z.ZodOptional<z.ZodString>;
    enrolmentYear: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<["NEW", "CONTACTED", "APPOINTMENT_BOOKED", "FOLLOW_UP", "ENROLLED", "LOST"]>>;
    notes: z.ZodOptional<z.ZodString>;
    lostReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status?: "NEW" | "CONTACTED" | "APPOINTMENT_BOOKED" | "FOLLOW_UP" | "ENROLLED" | "LOST";
    childName?: string;
    parentPhone?: string;
    childDob?: string;
    enrolmentYear?: number;
    notes?: string;
    lostReason?: string;
}, {
    status?: "NEW" | "CONTACTED" | "APPOINTMENT_BOOKED" | "FOLLOW_UP" | "ENROLLED" | "LOST";
    childName?: string;
    parentPhone?: string;
    childDob?: string;
    enrolmentYear?: number;
    notes?: string;
    lostReason?: string;
}>;
//# sourceMappingURL=lead.validator.d.ts.map