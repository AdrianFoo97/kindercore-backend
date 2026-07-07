import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq, desc, and, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { studentAttendance, students, leads } from '../db/schema.js';

// Same-card double-tap suppression window. If a card was just scanned for
// this student in the last DEDUPE_WINDOW_MS, a follow-up tap returns the
// existing record instead of inserting a new one — so a double-beep on
// the reader doesn't pollute the log.
const DEDUPE_WINDOW_MS = 60_000; // 60s

const scanSchema = z.object({
  rfid: z.string().min(1).max(50),
  source: z.enum(['rfid', 'manual']).optional(),
  notes: z.string().max(500).nullable().optional(),
});

/**
 * POST /api/attendance/scan
 * Body: { rfid: string, source?: 'rfid'|'manual', notes?: string }
 *
 * Looks up the student by RFID and records an attendance row. Public —
 * physical readers don't carry user JWTs. Returns the student + record so
 * the reader can show a confirmation ("Welcome, Alicia!").
 *
 * Response shape:
 *   200 { ok: true, deduplicated: boolean, student: {...}, attendance: {...} }
 *   404 when no student matches the RFID
 *   400 when the body is invalid
 */
export async function scanRfid(req: Request, res: Response): Promise<void> {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid scan payload', errors: parsed.error.errors });
    return;
  }
  const rfid = parsed.data.rfid.trim();
  const source = parsed.data.source ?? 'rfid';
  const notes = parsed.data.notes ?? null;

  const [student] = await db
    .select({
      id: students.id, leadId: students.leadId,
      childName: students.childName,
      leadChildName: leads.childName,
      withdrawnAt: students.withdrawnAt,
    })
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id))
    .where(eq(students.rfid, rfid))
    .limit(1);

  if (!student) {
    res.status(404).json({ ok: false, message: 'No student found for this card', rfid });
    return;
  }

  // Suppress duplicate scans within DEDUPE_WINDOW_MS — protects against
  // double-beeps from the reader and accidental re-taps.
  const dedupeAfter = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const [recent] = await db.select().from(studentAttendance)
    .where(and(
      eq(studentAttendance.studentId, student.id),
      gte(studentAttendance.scannedAt, dedupeAfter),
    ))
    .orderBy(desc(studentAttendance.scannedAt))
    .limit(1);

  if (recent) {
    res.json({
      ok: true,
      deduplicated: true,
      student: {
        id: student.id,
        childName: student.childName ?? student.leadChildName ?? null,
        withdrawn: !!student.withdrawnAt,
      },
      attendance: recent,
    });
    return;
  }

  const now = new Date();
  const id = randomUUID();
  await db.insert(studentAttendance).values({
    id,
    studentId: student.id,
    scannedAt: now,
    source,
    notes,
    createdAt: now,
  });

  const [created] = await db.select().from(studentAttendance).where(eq(studentAttendance.id, id));
  res.json({
    ok: true,
    deduplicated: false,
    student: {
      id: student.id,
      childName: student.childName ?? student.leadChildName ?? null,
      withdrawn: !!student.withdrawnAt,
    },
    attendance: created,
  });
}

/**
 * GET /api/students/:id/attendance
 * Returns the student's attendance records (newest first), capped at 200
 * to keep the page responsive. The Attendance tab on the student page
 * consumes this endpoint.
 */
export async function getStudentAttendance(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const rows = await db.select().from(studentAttendance)
    .where(eq(studentAttendance.studentId, id))
    .orderBy(desc(studentAttendance.scannedAt))
    .limit(200);
  res.json(rows);
}

/**
 * DELETE /api/attendance/:attendanceId
 * Removes a single attendance record (e.g. an erroneous manual entry).
 */
export async function deleteAttendance(req: Request, res: Response): Promise<void> {
  const { attendanceId } = req.params;
  await db.delete(studentAttendance).where(eq(studentAttendance.id, attendanceId));
  res.json({ ok: true });
}
