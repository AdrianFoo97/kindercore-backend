import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
describe('Auth - password hashing', () => {
    it('verifies correct password against hash', async () => {
        const hash = await bcrypt.hash('Admin123!', 10);
        const valid = await bcrypt.compare('Admin123!', hash);
        expect(valid).toBe(true);
    });
    it('rejects wrong password against hash', async () => {
        const hash = await bcrypt.hash('Admin123!', 10);
        const valid = await bcrypt.compare('wrongpassword', hash);
        expect(valid).toBe(false);
    });
});
//# sourceMappingURL=auth.test.js.map