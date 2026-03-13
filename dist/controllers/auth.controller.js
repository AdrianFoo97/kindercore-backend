"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_js_1 = require("../db/client.js");
const auth_validator_js_1 = require("../validators/auth.validator.js");
async function login(req, res) {
    const parsed = auth_validator_js_1.loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res
            .status(400)
            .json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { email, password } = parsed.data;
    const user = await client_js_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        res.status(401).json({ message: 'Invalid credentials' });
        return;
    }
    const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!valid) {
        res.status(401).json({ message: 'Invalid credentials' });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
}
//# sourceMappingURL=auth.controller.js.map