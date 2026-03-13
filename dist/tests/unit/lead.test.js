"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const lead_validator_js_1 = require("../../validators/lead.validator.js");
(0, vitest_1.describe)('Lead intake validation', () => {
    (0, vitest_1.it)('accepts a valid lead submission', () => {
        const result = lead_validator_js_1.createLeadSchema.safeParse({
            childName: 'Alice',
            parentPhone: '0123456789',
            childAge: '3',
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)('rejects submission when honeypot field is filled', () => {
        const result = lead_validator_js_1.createLeadSchema.safeParse({
            childName: 'Alice',
            parentPhone: '0123456789',
            childAge: '3',
            company: 'Spammer Inc',
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)('rejects missing required fields', () => {
        const result = lead_validator_js_1.createLeadSchema.safeParse({ childName: '' });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
});
//# sourceMappingURL=lead.test.js.map