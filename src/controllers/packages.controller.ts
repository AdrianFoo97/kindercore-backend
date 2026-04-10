import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { packages, students, systemSettings } from '../db/schema.js';

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

  // Auto-generate packages for current year and next year if they don't exist
  if (year !== undefined && !isNaN(year)) {
    const yearsToCheck = [year];
    if (year === CURRENT_YEAR) yearsToCheck.push(CURRENT_YEAR + 1);

    const [programmes, ages] = await Promise.all([
      getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES),
      getOrInitSetting<number[]>('package_ages', DEFAULT_AGES),
    ]);

    for (const y of yearsToCheck) {
      const existing = await db.select({ id: packages.id }).from(packages).where(eq(packages.year, y)).limit(1);
      if (existing.length === 0) {
        const now = new Date();
        const values = programmes.flatMap(programme =>
          ages.map(age => ({
            id: randomUUID(),
            year: y,
            programme,
            age,
            name: `${y} ${programme} (${age}Y)`,
            price: 500,
            updatedAt: now,
          }))
        );
        if (values.length > 0) await db.insert(packages).values(values);
      }
    }
  }

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
  const nextYear = CURRENT_YEAR + 1;
  if (!years.includes(nextYear)) years.unshift(nextYear);
  if (!years.includes(CURRENT_YEAR)) years.splice(years.indexOf(nextYear) + 1, 0, CURRENT_YEAR);
  years.sort((a, b) => b - a);
  res.json(years);
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getPackagesConfig(_req: Request, res: Response): Promise<void> {
  let [programmes, ages] = await Promise.all([
    getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES),
    getOrInitSetting<number[]>('package_ages', DEFAULT_AGES),
  ]);

  // Count packages and active students per programme and per age
  const progPkgRows = await db
    .select({ programme: packages.programme, count: sql<number>`COUNT(*)` })
    .from(packages)
    .groupBy(packages.programme);
  const progStuRows = await db
    .select({ programme: packages.programme, count: sql<number>`COUNT(${students.id})` })
    .from(packages)
    .leftJoin(students, eq(students.packageId, packages.id))
    .groupBy(packages.programme);
  const agePkgRows = await db
    .select({ age: packages.age, count: sql<number>`COUNT(*)` })
    .from(packages)
    .groupBy(packages.age);
  const ageStuRows = await db
    .select({ age: packages.age, count: sql<number>`COUNT(${students.id})` })
    .from(packages)
    .leftJoin(students, eq(students.packageId, packages.id))
    .groupBy(packages.age);

  const progPkgMap = new Map(progPkgRows.map(r => [r.programme, Number(r.count)]));
  const progStuMap = new Map(progStuRows.map(r => [r.programme, Number(r.count)]));
  const agePkgMap = new Map(agePkgRows.map(r => [r.age, Number(r.count)]));
  const ageStuMap = new Map(ageStuRows.map(r => [r.age, Number(r.count)]));

  // Self-heal: any programme/age that exists in the packages table but not in
  // the config list is an orphan from legacy data. Auto-merge them back into
  // the config so the system has a single source of truth.
  const orphanProgrammes = [...progPkgMap.keys()].filter(p => !programmes.includes(p));
  const orphanAges = [...agePkgMap.keys()].filter(a => !ages.includes(a));
  const now = new Date();
  if (orphanProgrammes.length > 0) {
    programmes = [...programmes, ...orphanProgrammes];
    await db.update(systemSettings)
      .set({ value: programmes as any, updatedAt: now })
      .where(eq(systemSettings.key, 'package_programmes'));
  }
  if (orphanAges.length > 0) {
    ages = [...ages, ...orphanAges].sort((a, b) => a - b);
    await db.update(systemSettings)
      .set({ value: ages as any, updatedAt: now })
      .where(eq(systemSettings.key, 'package_ages'));
  }

  const programmesDetail = programmes.map(p => ({
    name: p,
    packageCount: progPkgMap.get(p) ?? 0,
    studentCount: progStuMap.get(p) ?? 0,
  }));
  const agesDetail = ages.map(a => ({
    age: a,
    packageCount: agePkgMap.get(a) ?? 0,
    studentCount: ageStuMap.get(a) ?? 0,
  }));

  res.json({ programmes, ages, programmesDetail, agesDetail });
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

  // Validate programme + age exist in the config so we don't create orphan packages
  const [progs, ages] = await Promise.all([
    getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES),
    getOrInitSetting<number[]>('package_ages', DEFAULT_AGES),
  ]);
  if (!progs.includes(programme)) {
    res.status(400).json({ message: `Programme "${programme}" is not in the configured programmes list. Add it under Settings → Programmes first.` });
    return;
  }
  if (!ages.includes(age)) {
    res.status(400).json({ message: `Age ${age} is not in the configured ages list. Add it under Settings → Ages first.` });
    return;
  }

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

  // Block delete if any student is currently assigned to this package
  const [stuRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(students)
    .where(eq(students.packageId, id));
  const studentCount = Number(stuRow?.count ?? 0);
  if (studentCount > 0) {
    res.status(409).json({
      message: `Cannot delete this package — ${studentCount} student${studentCount !== 1 ? 's are' : ' is'} still assigned to it. Reassign them first.`,
      studentCount,
    });
    return;
  }

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
  // Explicit display order. When provided, the saved list reflects this order
  // exactly. Caller should pass the full final list (post-add, post-rename).
  order: z.array(z.string()).optional(),
  // Optional: reassign all packages from a removed programme to another existing programme.
  // Format: { 'Half Day + Enrichment': 'Half Day' }
  reassignPackages: z.record(z.string(), z.string()).optional().default({}),
});

export async function updateProgrammes(req: Request, res: Response): Promise<void> {
  const parsed = updateProgrammesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { renames, add, remove, order, reassignPackages } = parsed.data;
  const current = await getOrInitSetting<string[]>('package_programmes', DEFAULT_PROGRAMMES);

  // Apply package reassignments BEFORE the in-use check, so removing a programme
  // becomes safe if all its packages get moved to another programme.
  // Each (from → to) move:
  //   - if a target package already exists for the same year+age → merge:
  //       move students to the target, delete the source package
  //   - otherwise → simple rename: UPDATE the package row's programme
  for (const [fromProgramme, toProgramme] of Object.entries(reassignPackages)) {
    if (!toProgramme || fromProgramme === toProgramme) continue;
    if (!current.includes(toProgramme)) {
      res.status(400).json({ message: `Cannot reassign to "${toProgramme}" — it's not a valid programme` });
      return;
    }
    const sourcePkgs = await db.select().from(packages).where(eq(packages.programme, fromProgramme));
    for (const src of sourcePkgs) {
      const [target] = await db
        .select()
        .from(packages)
        .where(and(
          eq(packages.programme, toProgramme),
          eq(packages.year, src.year),
          eq(packages.age, src.age),
        ))
        .limit(1);
      if (target) {
        // Merge: move students from src → target, then delete src
        await db.update(students)
          .set({ packageId: target.id, monthlyFee: target.price ?? 0 })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, false)));
        await db.update(students)
          .set({ packageId: target.id })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, true)));
        await db.delete(packages).where(eq(packages.id, src.id));
      } else {
        await db.update(packages).set({ programme: toProgramme, updatedAt: new Date() }).where(eq(packages.id, src.id));
      }
    }
  }

  // Block any delete that would orphan packages — no force option, ever.
  if (remove.length) {
    const conflicts: Array<{ programme: string; packageCount: number; studentCount: number }> = [];
    for (const programme of remove) {
      const [pkgRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(packages)
        .where(eq(packages.programme, programme));
      const [stuRow] = await db
        .select({ count: sql<number>`COUNT(${students.id})` })
        .from(packages)
        .leftJoin(students, eq(students.packageId, packages.id))
        .where(eq(packages.programme, programme));
      const packageCount = Number(pkgRow?.count ?? 0);
      const studentCount = Number(stuRow?.count ?? 0);
      if (packageCount > 0 || studentCount > 0) {
        conflicts.push({ programme, packageCount, studentCount });
      }
    }
    if (conflicts.length > 0) {
      res.status(409).json({
        message: 'Cannot delete programmes that are still in use. Remove the dependent packages first.',
        conflicts,
      });
      return;
    }
  }

  let updated = current.map((p) => { const r = renames.find((r) => r.from === p); return r ? r.to : p; });
  // Dedupe in case a rename collided with an existing value
  updated = [...new Set(updated)];
  updated = updated.filter((p) => !remove.includes(p));
  for (const name of add) { if (!updated.includes(name)) updated.push(name); }

  // If the caller supplied an explicit order, use it as the source of truth
  // (filtered to only known values). Append anything missing as a defensive fallback.
  if (order && order.length > 0) {
    const known = new Set(updated);
    updated = order.filter(p => known.has(p));
    for (const p of [...known].filter(p => !updated.includes(p))) updated.push(p);
  }

  const now = new Date();
  await Promise.all(
    renames.map(({ from, to }) =>
      db.update(packages).set({ programme: to, updatedAt: now }).where(eq(packages.programme, from)),
    ),
  );
  // No cascading deletes — if we got here, `remove` is safe (no conflicts).
  await db.update(systemSettings).set({ value: updated as any, updatedAt: now }).where(eq(systemSettings.key, 'package_programmes'));
  res.json({ programmes: updated });
}

// ── Ages config ───────────────────────────────────────────────────────────────

const updateAgesSchema = z.object({
  add: z.array(z.number().int().min(0)).default([]),
  remove: z.array(z.number().int().min(0)).default([]),
  renames: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })).default([]),
  // Explicit display order — when provided, the saved list reflects this order
  // exactly (no auto-sort). Caller should pass the full final list.
  order: z.array(z.number().int().min(0)).optional(),
  // Optional: reassign all packages from a removed age to another existing age.
  // Format: { '5': 6 } — reassign Age 5 packages to Age 6
  reassignPackages: z.record(z.string(), z.number().int().min(0)).optional().default({}),
});

export async function updateAges(req: Request, res: Response): Promise<void> {
  const parsed = updateAgesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { add, remove, renames, order, reassignPackages } = parsed.data;
  const current = await getOrInitSetting<number[]>('package_ages', DEFAULT_AGES);

  // Apply renames first — cascade the new value to packages, with merge semantics
  // when the target already exists for the same year + programme.
  for (const { from, to } of renames) {
    if (from === to) continue;
    const sourcePkgs = await db.select().from(packages).where(eq(packages.age, from));
    for (const src of sourcePkgs) {
      const [target] = await db
        .select()
        .from(packages)
        .where(and(
          eq(packages.age, to),
          eq(packages.year, src.year),
          eq(packages.programme, src.programme),
        ))
        .limit(1);
      if (target) {
        await db.update(students)
          .set({ packageId: target.id, monthlyFee: target.price ?? 0 })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, false)));
        await db.update(students)
          .set({ packageId: target.id })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, true)));
        await db.delete(packages).where(eq(packages.id, src.id));
      } else {
        await db.update(packages).set({ age: to, updatedAt: new Date() }).where(eq(packages.id, src.id));
      }
    }
  }

  // Apply age reassignments (used by the "reassign and remove" flow)
  for (const [fromAgeStr, toAge] of Object.entries(reassignPackages)) {
    const fromAge = parseInt(fromAgeStr, 10);
    if (isNaN(fromAge) || fromAge === toAge) continue;
    if (!current.includes(toAge)) {
      res.status(400).json({ message: `Cannot reassign to Age ${toAge} — it's not a valid age` });
      return;
    }
    const sourcePkgs = await db.select().from(packages).where(eq(packages.age, fromAge));
    for (const src of sourcePkgs) {
      const [target] = await db
        .select()
        .from(packages)
        .where(and(
          eq(packages.age, toAge),
          eq(packages.year, src.year),
          eq(packages.programme, src.programme),
        ))
        .limit(1);
      if (target) {
        await db.update(students)
          .set({ packageId: target.id, monthlyFee: target.price ?? 0 })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, false)));
        await db.update(students)
          .set({ packageId: target.id })
          .where(and(eq(students.packageId, src.id), eq(students.feeOverridden, true)));
        await db.delete(packages).where(eq(packages.id, src.id));
      } else {
        await db.update(packages).set({ age: toAge, updatedAt: new Date() }).where(eq(packages.id, src.id));
      }
    }
  }

  if (remove.length) {
    const conflicts: Array<{ age: number; packageCount: number; studentCount: number }> = [];
    for (const age of remove) {
      const [pkgRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(packages)
        .where(eq(packages.age, age));
      const [stuRow] = await db
        .select({ count: sql<number>`COUNT(${students.id})` })
        .from(packages)
        .leftJoin(students, eq(students.packageId, packages.id))
        .where(eq(packages.age, age));
      const packageCount = Number(pkgRow?.count ?? 0);
      const studentCount = Number(stuRow?.count ?? 0);
      if (packageCount > 0 || studentCount > 0) {
        conflicts.push({ age, packageCount, studentCount });
      }
    }
    if (conflicts.length > 0) {
      res.status(409).json({
        message: 'Cannot delete ages that are still in use. Remove the dependent packages first.',
        conflicts,
      });
      return;
    }
  }

  // Build the new list. Apply renames first, then strip removes, then add new.
  let updated = current.map(a => {
    const r = renames.find(r => r.from === a);
    return r ? r.to : a;
  });
  // Dedupe (in case a rename collided with an existing value)
  updated = [...new Set(updated)];
  updated = updated.filter(a => !remove.includes(a));
  for (const age of add) { if (!updated.includes(age)) updated.push(age); }

  // If the caller supplied an explicit order, use it as the source of truth
  // (filtered to only known values). Otherwise preserve the natural list order.
  if (order && order.length > 0) {
    const known = new Set(updated);
    updated = order.filter(a => known.has(a));
    // Append any values that weren't included in the order payload (defensive)
    for (const a of [...known].filter(a => !updated.includes(a))) updated.push(a);
  }

  const now = new Date();
  await db.update(systemSettings).set({ value: updated as any, updatedAt: now }).where(eq(systemSettings.key, 'package_ages'));
  res.json({ ages: updated });
}
