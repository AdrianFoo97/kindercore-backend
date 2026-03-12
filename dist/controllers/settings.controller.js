import { z } from 'zod';
import { prisma } from '../db/client.js';
const updateSettingSchema = z.object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
});
export async function getSettings(_req, res) {
    const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    const result = {};
    for (const row of rows) {
        result[row.key] = row.value;
    }
    res.json(result);
}
export async function updateSetting(req, res) {
    const { key } = req.params;
    const parsed = updateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const updated = await prisma.systemSetting.upsert({
        where: { key },
        update: { value: parsed.data.value },
        create: { key, value: parsed.data.value },
    });
    res.json({ key: updated.key, value: updated.value });
}
//# sourceMappingURL=settings.controller.js.map