"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
function roundUpTo30Min(date) {
    const result = new Date(date);
    const minutes = result.getMinutes();
    const remainder = minutes % 30;
    if (remainder === 0)
        return result;
    result.setMinutes(minutes + (30 - remainder), 0, 0);
    return result;
}
(0, vitest_1.describe)('Appointment time rounding', () => {
    (0, vitest_1.it)('rounds 14:17 up to 14:30', () => {
        const d = new Date('2024-01-01T14:17:00');
        const rounded = roundUpTo30Min(d);
        (0, vitest_1.expect)(rounded.getHours()).toBe(14);
        (0, vitest_1.expect)(rounded.getMinutes()).toBe(30);
    });
    (0, vitest_1.it)('rounds 14:37 up to 15:00', () => {
        const d = new Date('2024-01-01T14:37:00');
        const rounded = roundUpTo30Min(d);
        (0, vitest_1.expect)(rounded.getHours()).toBe(15);
        (0, vitest_1.expect)(rounded.getMinutes()).toBe(0);
    });
    (0, vitest_1.it)('keeps 14:30 unchanged (already on boundary)', () => {
        const d = new Date('2024-01-01T14:30:00');
        const rounded = roundUpTo30Min(d);
        (0, vitest_1.expect)(rounded.getHours()).toBe(14);
        (0, vitest_1.expect)(rounded.getMinutes()).toBe(30);
    });
    (0, vitest_1.it)('keeps 14:00 unchanged (already on boundary)', () => {
        const d = new Date('2024-01-01T14:00:00');
        const rounded = roundUpTo30Min(d);
        (0, vitest_1.expect)(rounded.getHours()).toBe(14);
        (0, vitest_1.expect)(rounded.getMinutes()).toBe(0);
    });
    (0, vitest_1.it)('rounds 23:59 up to 00:00 next day', () => {
        const d = new Date('2024-01-01T23:59:00');
        const rounded = roundUpTo30Min(d);
        (0, vitest_1.expect)(rounded.getHours()).toBe(0);
        (0, vitest_1.expect)(rounded.getMinutes()).toBe(0);
        (0, vitest_1.expect)(rounded.getDate()).toBe(2);
    });
});
//# sourceMappingURL=appointment.test.js.map