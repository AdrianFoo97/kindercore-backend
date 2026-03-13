"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.updateSetting = updateSetting;
const zod_1 = require("zod");
const client_js_1 = require("../db/client.js");
const updateSettingSchema = zod_1.z.object({
    value: zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean(), zod_1.z.null(), zod_1.z.array(zod_1.z.string())]),
});
async function getSettings(_req, res) {
    const rows = await client_js_1.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    const result = {};
    for (const row of rows) {
        result[row.key] = row.value;
    }
    res.json(result);
}
async function updateSetting(req, res) {
    const { key } = req.params;
    const parsed = updateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const updated = await client_js_1.prisma.systemSetting.upsert({
        where: { key },
        update: { value: parsed.data.value },
        create: { key, value: parsed.data.value },
    });
    res.json({ key: updated.key, value: updated.value });
}
//# sourceMappingURL=settings.controller.js.map