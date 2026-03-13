"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPackages = getPackages;
exports.getPackageYears = getPackageYears;
exports.getPackagesConfig = getPackagesConfig;
exports.createPackage = createPackage;
exports.deletePackage = deletePackage;
exports.patchPackageName = patchPackageName;
exports.upsertPackages = upsertPackages;
exports.updateProgrammes = updateProgrammes;
exports.updateAges = updateAges;
const zod_1 = require("zod");
const client_js_1 = require("../db/client.js");
const DEFAULT_PROGRAMMES = ['Half Day', 'Full Day', 'Half Day + Enrichment'];
const DEFAULT_AGES = [2, 3, 4, 5, 6];
const CURRENT_YEAR = new Date().getFullYear();
// ── Config helpers ────────────────────────────────────────────────────────────
async function getOrInitSetting(key, defaultValue) {
    const row = await client_js_1.prisma.systemSetting.findUnique({ where: { key } });
    if (row)
        return row.value;
    await client_js_1.prisma.systemSetting.create({ data: { key, value: defaultValue } });
    return defaultValue;
}
// ── Get packages (optionally filtered by year) ────────────────────────────────
async function getPackages(req, res) {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const where = year !== undefined && !isNaN(year) ? { year } : {};
    const rows = await client_js_1.prisma.package.findMany({ where, orderBy: [{ programme: 'asc' }, { age: 'asc' }] });
    res.json(rows);
}
// ── Get distinct years that have packages ─────────────────────────────────────
async function getPackageYears(_req, res) {
    const rows = await client_js_1.prisma.package.findMany({ select: { year: true }, distinct: ['year'], orderBy: { year: 'desc' } });
    const years = rows.map((r) => r.year);
    if (!years.includes(CURRENT_YEAR))
        years.unshift(CURRENT_YEAR);
    res.json(years);
}
// ── Config ────────────────────────────────────────────────────────────────────
async function getPackagesConfig(_req, res) {
    const [programmes, ages] = await Promise.all([
        getOrInitSetting('package_programmes', DEFAULT_PROGRAMMES),
        getOrInitSetting('package_ages', DEFAULT_AGES),
    ]);
    res.json({ programmes, ages });
}
// ── Create a package slot ─────────────────────────────────────────────────────
const createSchema = zod_1.z.object({
    year: zod_1.z.number().int().min(2000).max(2100),
    programme: zod_1.z.string().min(1),
    age: zod_1.z.number().int().min(0),
    name: zod_1.z.string().min(1),
    price: zod_1.z.number().min(0),
});
async function createPackage(req, res) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { year, programme, age, name, price } = parsed.data;
    const existing = await client_js_1.prisma.package.findUnique({ where: { year_programme_age: { year, programme, age } } });
    if (existing) {
        res.status(409).json({ message: `Package for ${year} ${programme} Age ${age} already exists` });
        return;
    }
    const pkg = await client_js_1.prisma.package.create({ data: { year, programme, age, name, price } });
    res.status(201).json(pkg);
}
// ── Delete a package slot ─────────────────────────────────────────────────────
async function deletePackage(req, res) {
    const { id } = req.params;
    const existing = await client_js_1.prisma.package.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Package not found' });
        return;
    }
    await client_js_1.prisma.package.delete({ where: { id } });
    res.status(204).send();
}
// ── Patch name ────────────────────────────────────────────────────────────────
const patchNameSchema = zod_1.z.object({ name: zod_1.z.string().min(1) });
async function patchPackageName(req, res) {
    const { id } = req.params;
    const parsed = patchNameSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const existing = await client_js_1.prisma.package.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: 'Package not found' });
        return;
    }
    const updated = await client_js_1.prisma.package.update({ where: { id }, data: { name: parsed.data.name } });
    res.json(updated);
}
// ── Bulk upsert prices ────────────────────────────────────────────────────────
const upsertSchema = zod_1.z.object({
    year: zod_1.z.number().int(),
    programme: zod_1.z.string().min(1),
    age: zod_1.z.number().int().min(0),
    price: zod_1.z.number().min(0).nullable(),
});
async function upsertPackages(req, res) {
    const parsed = zod_1.z.array(upsertSchema).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    await Promise.all(parsed.data.map((item) => client_js_1.prisma.package.updateMany({
        where: { year: item.year, programme: item.programme, age: item.age },
        data: { price: item.price },
    })));
    const years = [...new Set(parsed.data.map((i) => i.year))];
    const updated = await client_js_1.prisma.package.findMany({ where: { year: { in: years } }, orderBy: [{ programme: 'asc' }, { age: 'asc' }] });
    res.json(updated);
}
// ── Programmes config ─────────────────────────────────────────────────────────
const updateProgrammesSchema = zod_1.z.object({
    renames: zod_1.z.array(zod_1.z.object({ from: zod_1.z.string(), to: zod_1.z.string() })).default([]),
    add: zod_1.z.array(zod_1.z.string()).default([]),
    remove: zod_1.z.array(zod_1.z.string()).default([]),
});
async function updateProgrammes(req, res) {
    const parsed = updateProgrammesSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { renames, add, remove } = parsed.data;
    const current = await getOrInitSetting('package_programmes', DEFAULT_PROGRAMMES);
    let updated = current.map((p) => { const r = renames.find((r) => r.from === p); return r ? r.to : p; });
    updated = updated.filter((p) => !remove.includes(p));
    for (const name of add) {
        if (!updated.includes(name))
            updated.push(name);
    }
    await Promise.all(renames.map(({ from, to }) => client_js_1.prisma.package.updateMany({ where: { programme: from }, data: { programme: to } })));
    if (remove.length)
        await client_js_1.prisma.package.deleteMany({ where: { programme: { in: remove } } });
    await client_js_1.prisma.systemSetting.update({ where: { key: 'package_programmes' }, data: { value: updated } });
    res.json({ programmes: updated });
}
// ── Ages config ───────────────────────────────────────────────────────────────
const updateAgesSchema = zod_1.z.object({
    add: zod_1.z.array(zod_1.z.number().int().min(0)).default([]),
    remove: zod_1.z.array(zod_1.z.number().int().min(0)).default([]),
});
async function updateAges(req, res) {
    const parsed = updateAgesSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { add, remove } = parsed.data;
    const current = await getOrInitSetting('package_ages', DEFAULT_AGES);
    let updated = current.filter((a) => !remove.includes(a));
    for (const age of add) {
        if (!updated.includes(age))
            updated.push(age);
    }
    updated.sort((a, b) => a - b);
    if (remove.length)
        await client_js_1.prisma.package.deleteMany({ where: { age: { in: remove } } });
    await client_js_1.prisma.systemSetting.update({ where: { key: 'package_ages' }, data: { value: updated } });
    res.json({ ages: updated });
}
//# sourceMappingURL=packages.controller.js.map