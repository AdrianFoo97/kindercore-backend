"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.updateSetting = updateSetting;
const zod_1 = require("zod");
const drizzle_orm_1 = require("drizzle-orm");
const client_js_1 = require("../db/client.js");
const schema_js_1 = require("../db/schema.js");
const updateSettingSchema = zod_1.z.object({
    value: zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean(), zod_1.z.null(), zod_1.z.array(zod_1.z.string())]),
});
async function getSettings(_req, res) {
    const rows = await client_js_1.db.select().from(schema_js_1.systemSettings).orderBy((0, drizzle_orm_1.asc)(schema_js_1.systemSettings.key));
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
    const now = new Date();
    const val = parsed.data.value;
    // INSERT ... ON DUPLICATE KEY UPDATE (key has a UNIQUE constraint in DB)
    await client_js_1.db
        .insert(schema_js_1.systemSettings)
        .values({ id: crypto.randomUUID(), key, value: val, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { value: val, updatedAt: now } });
    res.json({ key, value: parsed.data.value });
}
//# sourceMappingURL=settings.controller.js.map