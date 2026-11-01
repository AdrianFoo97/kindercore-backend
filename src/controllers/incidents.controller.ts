import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { incidentReportLogs, incidentReports, incidentReportStudents, leads, students, users } from '../db/schema.js';

// Incident reports (Operation → Incidents), replacing the old Google Form.
// Any staff member files one — teachers from their mobile app — and the
// Operation module follows it up: OPEN → PARENT_INFORMED → RESOLVED.

export const INCIDENT_STATUSES = ['OPEN', 'PARENT_INFORMED', 'RESOLVED'] as const;

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Today in Malaysia (UTC+8), as 'YYYY-MM-DD' — the centre's own calendar day. */
export function todayInMalaysia(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const detailsSchema = z.object({
  incidentDate: z.string().regex(DATE_RE, 'Use the date picker (YYYY-MM-DD)')
    .refine(d => d <= todayInMalaysia(), 'The incident date can’t be in the future'),
  incidentTime: z.string().regex(TIME_RE, 'Use a time like 10:30'),
  location: z.string().trim().min(1, 'Where did it happen?').max(191),
  description: z.string().trim().min(1, 'Describe what happened').max(5000),
  actionsTaken: z.string().trim().min(1, 'What was done straight away?').max(5000),
  studentIds: z.array(z.string().max(36)).max(30).default([]),
  otherChildren: z.string().trim().max(500).nullable().optional(),
});

// Same "names of students involved" rule as the old form: at least one child.
const createSchema = detailsSchema.refine(
  d => d.studentIds.length > 0 || !!d.otherChildren,
  { message: 'Add at least one child involved', path: ['studentIds'] },
);

// Correcting the details. Status only moves through the log (addIncidentLog)
// so every move is recorded with who, when and why.
const updateSchema = detailsSchema.partial();

export const PARENT_REACTIONS = ['SATISFIED', 'NEUTRAL', 'CONCERNED', 'UPSET'] as const;

// A follow-up log entry: a comment, a status move, or both — optionally
// tagged with how satisfied the parent was (only alongside a comment).
const logSchema = z.object({
  note: z.string().trim().max(5000).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  parentReaction: z.enum(PARENT_REACTIONS).optional(),
});

type ReportRow = typeof incidentReports.$inferSelect;
type LogRow = typeof incidentReportLogs.$inferSelect;
export type IncidentReport = ReportRow & {
  students: { studentId: string; childName: string }[];
  /** Oldest first. */
  log: Omit<LogRow, 'incidentReportId'>[];
};

async function withStudents(rows: ReportRow[]): Promise<IncidentReport[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const links = await db.select().from(incidentReportStudents)
    .where(inArray(incidentReportStudents.incidentReportId, ids));
  const logs = await db.select().from(incidentReportLogs)
    .where(inArray(incidentReportLogs.incidentReportId, ids))
    .orderBy(asc(incidentReportLogs.createdAt));
  return rows.map(r => ({
    ...r,
    students: links.filter(l => l.incidentReportId === r.id)
      .map(l => ({ studentId: l.studentId, childName: l.childName }))
      .sort((a, b) => a.childName.localeCompare(b.childName)),
    log: logs.filter(l => l.incidentReportId === r.id).map(({ incidentReportId: _, ...l }) => l),
  }));
}

const FIELD_LABELS: Record<string, string> = {
  incidentDate: 'date', incidentTime: 'time', location: 'location', description: 'what happened',
  actionsTaken: 'immediate actions', otherChildren: 'other children', studentIds: 'students involved',
};

async function loadOne(id: string): Promise<IncidentReport | null> {
  const [row] = await db.select().from(incidentReports).where(eq(incidentReports.id, id));
  return row ? (await withStudents([row]))[0] : null;
}

/** Name snapshots for the given student ids; null if any id isn't a real student. */
async function resolveStudents(ids: string[]): Promise<{ studentId: string; childName: string }[] | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.select({ id: students.id, studentName: students.childName, leadName: leads.childName })
    .from(students).leftJoin(leads, eq(students.leadId, leads.id))
    .where(inArray(students.id, unique));
  if (rows.length !== unique.length) return null;
  return rows.map(r => ({ studentId: r.id, childName: r.studentName ?? r.leadName ?? 'Unnamed child' }));
}

async function nameOf(userId: string, fallback: string): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name ?? fallback;
}

const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({ message: error.errors[0]?.message ?? 'Validation error', errors: error.errors });

/** Any signed-in staff member can file a report; "Reported by" is the caller, never typed in. */
export async function createIncident(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const d = parsed.data;

  const linked = await resolveStudents(d.studentIds);
  if (!linked) { res.status(400).json({ message: 'One of the selected students no longer exists' }); return; }

  const now = new Date();
  const id = randomUUID();
  await db.insert(incidentReports).values({
    id,
    incidentDate: d.incidentDate,
    incidentTime: d.incidentTime,
    location: d.location,
    description: d.description,
    actionsTaken: d.actionsTaken,
    otherChildren: d.otherChildren || null,
    status: 'OPEN',
    reportedByUserId: req.user!.id,
    reportedByName: await nameOf(req.user!.id, req.user!.email),
    createdAt: now,
    updatedAt: now,
  });
  if (linked.length) {
    await db.insert(incidentReportStudents).values(linked.map(l => ({ incidentReportId: id, ...l })));
  }
  res.status(201).json(await loadOne(id));
}

/** The caller's own reports — so a teacher can see what they filed and how it's going. */
export async function listMyIncidents(req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(incidentReports)
    .where(eq(incidentReports.reportedByUserId, req.user!.id))
    .orderBy(desc(incidentReports.incidentDate), desc(incidentReports.incidentTime));
  res.json(await withStudents(rows));
}

/** Every report — Operation module. */
export async function listIncidents(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(incidentReports)
    .orderBy(desc(incidentReports.incidentDate), desc(incidentReports.incidentTime));
  res.json(await withStudents(rows));
}

/**
 * Current (not withdrawn) students for the "Students involved" picker — id,
 * name and age only (the picker groups by age). Age is counted the way the
 * Students page counts it: this year minus birth year, plus the student's
 * manual age offset; null when no birth date is on file.
 */
export async function listIncidentStudentOptions(_req: Request, res: Response): Promise<void> {
  const rows = await db.select({
    id: students.id, studentName: students.childName, leadName: leads.childName,
    studentDob: students.childDob, leadDob: leads.childDob, ageOffset: students.ageOffset,
  })
    .from(students).leftJoin(leads, eq(students.leadId, leads.id))
    .where(isNull(students.withdrawnAt));
  const thisYear = Number(todayInMalaysia().slice(0, 4));
  res.json(rows
    .map(r => {
      const dob = r.studentDob ?? r.leadDob;
      return {
        id: r.id,
        childName: r.studentName ?? r.leadName ?? 'Unnamed child',
        age: dob ? thisYear - new Date(dob).getFullYear() + (r.ageOffset ?? 0) : null,
      };
    })
    .sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || a.childName.localeCompare(b.childName)));
}

/** Correct the report's details — Operation module. Logged as an EDIT entry naming what changed. */
export async function updateIncident(req: Request, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await loadOne(req.params.id);
  if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }
  const { studentIds, ...details } = parsed.data;

  let linked: { studentId: string; childName: string }[] | null = null;
  if (studentIds !== undefined) {
    linked = await resolveStudents(studentIds);
    if (!linked) { res.status(400).json({ message: 'One of the selected students no longer exists' }); return; }
  }
  const nextOther = details.otherChildren !== undefined ? (details.otherChildren || null) : existing.otherChildren;
  const nextCount = linked ? linked.length : existing.students.length;
  if (nextCount === 0 && !nextOther) { res.status(400).json({ message: 'Add at least one child involved' }); return; }

  // Which fields actually changed — that's what the log entry names.
  const changed = (Object.keys(details) as (keyof typeof details)[])
    .filter(k => k !== 'otherChildren' && details[k] !== existing[k]) as string[];
  if (nextOther !== existing.otherChildren) changed.push('otherChildren');
  const sameKids = linked && [...linked.map(l => l.studentId)].sort().join() === existing.students.map(s => s.studentId).sort().join();
  if (linked && !sameKids) changed.push('studentIds');
  if (changed.length === 0) { res.json(existing); return; }

  const now = new Date();
  await db.update(incidentReports).set({ ...details, otherChildren: nextOther, updatedAt: now })
    .where(eq(incidentReports.id, existing.id));
  if (linked && !sameKids) {
    await db.delete(incidentReportStudents).where(eq(incidentReportStudents.incidentReportId, existing.id));
    if (linked.length) await db.insert(incidentReportStudents).values(linked.map(l => ({ incidentReportId: existing.id, ...l })));
  }
  await db.insert(incidentReportLogs).values({
    id: randomUUID(), incidentReportId: existing.id, kind: 'EDIT',
    body: `Changed ${changed.map(k => FIELD_LABELS[k] ?? k).join(', ')}`,
    authorUserId: req.user!.id, authorName: await nameOf(req.user!.id, req.user!.email), createdAt: now,
  });
  res.json(await loadOne(existing.id));
}

/**
 * Add to the follow-up log — Operation module (supervisor / principal).
 * A comment, a status move, or both in one entry. Entries are never
 * edited or deleted, so the log is a faithful record of how it was handled.
 */
export async function addIncidentLog(req: Request, res: Response): Promise<void> {
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  const existing = await loadOne(req.params.id);
  if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }

  const note = parsed.data.note || null;
  const moves = parsed.data.status !== undefined && parsed.data.status !== existing.status;
  if (!note && !moves) { res.status(400).json({ message: 'Write a comment or change the status' }); return; }
  if (parsed.data.parentReaction && !note) {
    res.status(400).json({ message: 'Add a comment to go with the parent’s satisfaction' }); return;
  }

  const now = new Date();
  const authorName = await nameOf(req.user!.id, req.user!.email);
  await db.insert(incidentReportLogs).values({
    id: randomUUID(), incidentReportId: existing.id,
    kind: moves ? 'STATUS' : 'NOTE', body: note,
    statusFrom: moves ? existing.status : null, statusTo: moves ? parsed.data.status! : null,
    parentReaction: parsed.data.parentReaction ?? null,
    authorUserId: req.user!.id, authorName, createdAt: now,
  });
  await db.update(incidentReports).set(moves
    ? { status: parsed.data.status!, statusUpdatedByName: authorName, statusUpdatedAt: now, updatedAt: now }
    : { updatedAt: now })
    .where(eq(incidentReports.id, existing.id));
  res.status(201).json(await loadOne(existing.id));
}
