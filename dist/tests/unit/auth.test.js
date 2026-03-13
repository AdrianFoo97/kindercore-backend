"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
(0, vitest_1.describe)('Auth - password hashing', () => {
    (0, vitest_1.it)('verifies correct password against hash', async () => {
        const hash = await bcryptjs_1.default.hash('Admin123!', 10);
        const valid = await bcryptjs_1.default.compare('Admin123!', hash);
        (0, vitest_1.expect)(valid).toBe(true);
    });
    (0, vitest_1.it)('rejects wrong password against hash', async () => {
        const hash = await bcryptjs_1.default.hash('Admin123!', 10);
        const valid = await bcryptjs_1.default.compare('wrongpassword', hash);
        (0, vitest_1.expect)(valid).toBe(false);
    });
});
//# sourceMappingURL=auth.test.js.map