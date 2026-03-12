import { describe, it, expect } from 'vitest';
function roundUpTo30Min(date) {
    const result = new Date(date);
    const minutes = result.getMinutes();
    const remainder = minutes % 30;
    if (remainder === 0)
        return result;
    result.setMinutes(minutes + (30 - remainder), 0, 0);
    return result;
}
describe('Appointment time rounding', () => {
    it('rounds 14:17 up to 14:30', () => {
        const d = new Date('2024-01-01T14:17:00');
        const rounded = roundUpTo30Min(d);
        expect(rounded.getHours()).toBe(14);
        expect(rounded.getMinutes()).toBe(30);
    });
    it('rounds 14:37 up to 15:00', () => {
        const d = new Date('2024-01-01T14:37:00');
        const rounded = roundUpTo30Min(d);
        expect(rounded.getHours()).toBe(15);
        expect(rounded.getMinutes()).toBe(0);
    });
    it('keeps 14:30 unchanged (already on boundary)', () => {
        const d = new Date('2024-01-01T14:30:00');
        const rounded = roundUpTo30Min(d);
        expect(rounded.getHours()).toBe(14);
        expect(rounded.getMinutes()).toBe(30);
    });
    it('keeps 14:00 unchanged (already on boundary)', () => {
        const d = new Date('2024-01-01T14:00:00');
        const rounded = roundUpTo30Min(d);
        expect(rounded.getHours()).toBe(14);
        expect(rounded.getMinutes()).toBe(0);
    });
    it('rounds 23:59 up to 00:00 next day', () => {
        const d = new Date('2024-01-01T23:59:00');
        const rounded = roundUpTo30Min(d);
        expect(rounded.getHours()).toBe(0);
        expect(rounded.getMinutes()).toBe(0);
        expect(rounded.getDate()).toBe(2);
    });
});
//# sourceMappingURL=appointment.test.js.map