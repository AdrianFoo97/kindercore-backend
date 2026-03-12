import { describe, it, expect } from 'vitest';
import { createLeadSchema } from '../../validators/lead.validator.js';
describe('Lead intake validation', () => {
    it('accepts a valid lead submission', () => {
        const result = createLeadSchema.safeParse({
            childName: 'Alice',
            parentPhone: '0123456789',
            childAge: '3',
        });
        expect(result.success).toBe(true);
    });
    it('rejects submission when honeypot field is filled', () => {
        const result = createLeadSchema.safeParse({
            childName: 'Alice',
            parentPhone: '0123456789',
            childAge: '3',
            company: 'Spammer Inc',
        });
        expect(result.success).toBe(false);
    });
    it('rejects missing required fields', () => {
        const result = createLeadSchema.safeParse({ childName: '' });
        expect(result.success).toBe(false);
    });
});
//# sourceMappingURL=lead.test.js.map