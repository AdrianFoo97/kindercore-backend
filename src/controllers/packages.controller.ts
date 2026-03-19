import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { packages, systemSettings } from '../db/schema.js';

const DEFAULT_PROGRAMMES = ['Half Day', 'Full Day', 'Half Day + Enrichment'];
const DEFAULT_AGES = [2, 3, 4, 5, 6];
const CURRENT_YEAR = new Date().getFullYear();

// ── Config helpers ────────────────────────────────────────────────────────────

async function getOrInitSetting<T>(key: string, defaultValue: T): Promise<T> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (row) {
    const val = row.value;
    if (typeof val === 'string') {
      try { return JSON.parse(val) as T; } catch { return defaultValue; }
    }
    return val as T;
  }
  await db.insert(systemSettings).values({
    id: randomUUID(),
    key,
    value: defaultValue as any,
    updatedAt: new Date(),
  });
  return defaultValue;
}

// ── Get packages (optionally filtered by year) ────────────────────────────────

export async function getPackages(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const rows = await db
    .select()
    .from(packages)
    .where(year !== undefined && !isNaN(year) ? eq(packages.year, year) : undefined)
    .orderBy(asc(packages.programme), asc(packages.age));
  res.json(rows);
}

// ── Get distinct years that have packages ─────────────────────────────────────

export async function getPackageYears(_req: Request, res: Response): Promise<void> {
  const rows = await db
    .selectDistinct({ year: packages.year })
    .from(packages)
    .orderBy(desc(packages.year));
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

  const [existing] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.year, year), eq(packages.programme, programme), eq(packages.age, age)))
    .limit(1);
  if (existing) {
    res.status(409).json({ message: `Package for ${year} ${programme} Age ${age} already exists` });
    return;
  }

  const now = new Date();
  const id = randomUUID();
  await db.insert(packages).values({ id, year, programme, age, name, price, updatedAt: now });
  const [pkg] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
  res.status(201).json(pkg);
}

// ── Delete a package slot ─────────────────────────────────────────────────────

export async function deletePackage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Package not found' }); return; }
  await db.delete(packages).where(eq(packages.id, id));
  res.status(204).send();
}

// ── Patch package ─────────────────────────────────────────────────────────────

const patchPackageSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().min(0).optional(),
}).refine(d => d.name !== undefined || d.price !== undefined, { message: 'Provide name or price' });

export async function patchPackage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = patchPackageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Package not found' }); return; }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.price !== undefined) updates.price = parsed.data.price;
  await db.update(packages).set(updates).where(eq(packages.id, id));
  const [updated] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
  res.json(updated);
}

/** @deprecated kept for backwards compat — use patchPackage instead */
export const patchPackageName = patchPackage;

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

  const now = new Date();
  await Promise.all(
    parsed.data.map((item) =>
      db
        .update(packages)
        .set({ price: item.price, updatedAt: now })
        .where(and(eq(packages.year, item.year), eq(packages.programme, item.programme), eq(packages.age, item.age))),
    ),
  );

  const years = [...new Set(parsed.data.map((i) => i.year))];
  const updated = await db
    .select()
    .from(packages)
    .where(inArray(packages.year, years))
    .orderBy(asc(packages.programme), asc(packages.age));
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

  const now = new Date();
  await Promise.all(
    renames.map(({ from, to }) =>
      db.update(packages).set({ programme: to, updatedAt: now }).where(eq(packages.programme, from)),
    ),
  );
  if (remove.length) await db.delete(packages).where(inArray(packages.programme, remove));
  await db.update(systemSettings).set({ value: updated as any, updatedAt: now }).where(eq(systemSettings.key, 'package_programmes'));
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

  const now = new Date();
  if (remove.length) await db.delete(packages).where(inArray(packages.age, remove));
  await db.update(systemSettings).set({ value: updated as any, updatedAt: now }).where(eq(systemSettings.key, 'package_ages'));
  res.json({ ages: updated });
}
