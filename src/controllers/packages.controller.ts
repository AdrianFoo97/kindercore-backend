import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';

const DEFAULT_PROGRAMMES = ['Half Day', 'Full Day', 'Half Day + Enrichment'];
const DEFAULT_AGES = [2, 3, 4, 5, 6];
const CURRENT_YEAR = new Date().getFullYear();

// ── Config helpers ────────────────────────────────────────────────────────────

async function getOrInitSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (row) return row.value as T;
  await prisma.systemSetting.create({ data: { key, value: defaultValue as never } });
  return defaultValue;
}

// ── Get packages (optionally filtered by year) ────────────────────────────────

export async function getPackages(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const where = year !== undefined && !isNaN(year) ? { year } : {};
  const rows = await prisma.package.findMany({ where, orderBy: [{ programme: 'asc' }, { age: 'asc' }] });
  res.json(rows);
}

// ── Get distinct years that have packages ─────────────────────────────────────

export async function getPackageYears(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.package.findMany({ select: { year: true }, distinct: ['year'], orderBy: { year: 'desc' } });
  const years = rows.map((r) => r.year);
  if (!years.includes(CURRENT_YEAR)) years.unshift(CURRENT_YEAR);
  res.json(years);
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getPackagesConfig(_req: Request, res: Response): Promise<void> {
  const [programmes, ages] = await Promise.all([
    getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES),
    getOrInitSetting<number[]>('package_ages', DEFAULT_AGES),
  ]);
  res.json({ programmes, ages });
}

// ── Create a package slot ─────────────────────────────────────────────────────

const createSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  programme: z.string().min(1),
  age: z.number().int().min(0),
  name: z.string().min(1),
  price: z.number().min(0),
});

export async function createPackage(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { year, programme, age, name, price } = parsed.data;

  const existing = await prisma.package.findUnique({ where: { year_programme_age: { year, programme, age } } });
  if (existing) {
    res.status(409).json({ message: `Package for ${year} ${programme} Age ${age} already exists` });
    return;
  }

  const pkg = await prisma.package.create({ data: { year, programme, age, name, price } });
  res.status(201).json(pkg);
}

// ── Delete a package slot ─────────────────────────────────────────────────────

export async function deletePackage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const existing = await prisma.package.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ message: 'Package not found' }); return; }
  await prisma.package.delete({ where: { id } });
  res.status(204).send();
}

// ── Patch name ────────────────────────────────────────────────────────────────

const patchNameSchema = z.object({ name: z.string().min(1) });

export async function patchPackageName(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const existing = await prisma.package.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ message: 'Package not found' }); return; }
  const updated = await prisma.package.update({ where: { id }, data: { name: parsed.data.name } });
  res.json(updated);
}

// ── Bulk upsert prices ────────────────────────────────────────────────────────

const upsertSchema = z.object({
  year: z.number().int(),
  programme: z.string().min(1),
  age: z.number().int().min(0),
  price: z.number().min(0).nullable(),
});

export async function upsertPackages(req: Request, res: Response): Promise<void> {
  const parsed = z.array(upsertSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  await Promise.all(
    parsed.data.map((item) =>
      prisma.package.updateMany({
        where: { year: item.year, programme: item.programme, age: item.age },
        data: { price: item.price },
      }),
    ),
  );

  const years = [...new Set(parsed.data.map((i) => i.year))];
  const updated = await prisma.package.findMany({ where: { year: { in: years } }, orderBy: [{ programme: 'asc' }, { age: 'asc' }] });
  res.json(updated);
}

// ── Programmes config ─────────────────────────────────────────────────────────

const updateProgrammesSchema = z.object({
  renames: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
});

export async function updateProgrammes(req: Request, res: Response): Promise<void> {
  const parsed = updateProgrammesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { renames, add, remove } = parsed.data;
  const current = await getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES);

  let updated = current.map((p) => { const r = renames.find((r) => r.from === p); return r ? r.to : p; });
  updated = updated.filter((p) => !remove.includes(p));
  for (const name of add) { if (!updated.includes(name)) updated.push(name); }

  await Promise.all(renames.map(({ from, to }) => prisma.package.updateMany({ where: { programme: from }, data: { programme: to } })));
  if (remove.length) await prisma.package.deleteMany({ where: { programme: { in: remove } } });
  await prisma.systemSetting.update({ where: { key: 'package_programmes' }, data: { value: updated } });
  res.json({ programmes: updated });
}

// ── Ages config ───────────────────────────────────────────────────────────────

const updateAgesSchema = z.object({
  add: z.array(z.number().int().min(0)).default([]),
  remove: z.array(z.number().int().min(0)).default([]),
});

export async function updateAges(req: Request, res: Response): Promise<void> {
  const parsed = updateAgesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { add, remove } = parsed.data;
  const current = await getOrInitSetting<number[]>('package_ages', DEFAULT_AGES);

  let updated = current.filter((a) => !remove.includes(a));
  for (const age of add) { if (!updated.includes(age)) updated.push(age); }
  updated.sort((a, b) => a - b);

  if (remove.length) await prisma.package.deleteMany({ where: { age: { in: remove } } });
  await prisma.systemSetting.update({ where: { key: 'package_ages' }, data: { value: updated } });
  res.json({ ages: updated });
}
