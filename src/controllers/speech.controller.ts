import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { speechClips, students, leads } from '../db/schema.js';
import { generateSpeechWav } from '../services/elevenlabs.service.js';
import { UPLOAD_ROOT } from '../routes/upload.routes.js';

export const SPEECH_DIR = path.join(UPLOAD_ROOT, 'speech');
fs.mkdirSync(SPEECH_DIR, { recursive: true });

const generateSchema = z.object({
  text: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/students/:id/speech
 * Generates (or regenerates) the student's attendance greeting via
 * ElevenLabs, stores the WAV on disk, and replaces the SpeechClip row.
 */
export async function generateStudentSpeech(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
    return;
  }

  const [student] = await db
    .select({ id: students.id, childName: students.childName, leadChildName: leads.childName })
    .from(students)
    .leftJoin(leads, eq(students.leadId, leads.id))
    .where(eq(students.id, id))
    .limit(1);

  if (!student) {
    res.status(404).json({ message: 'Student not found' });
    return;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    res.status(500).json({ message: 'ELEVENLABS_VOICE_ID is not configured' });
    return;
  }

  const name = student.childName ?? student.leadChildName ?? 'there';
  const text = parsed.data.text?.trim() || `Good morning, ${name}!`;

  let audio: { buffer: Buffer; sampleRate: number };
  try {
    audio = await generateSpeechWav(text, voiceId);
  } catch (e: any) {
    res.status(502).json({ message: e?.message ?? 'Failed to generate speech' });
    return;
  }

  const filename = `${randomUUID()}.wav`;
  fs.writeFileSync(path.join(SPEECH_DIR, filename), audio.buffer);
  const filePath = `/uploads/speech/${filename}`;

  await db.delete(speechClips).where(eq(speechClips.studentId, id));
  const clipId = randomUUID();
  const now = new Date();
  await db.insert(speechClips).values({
    id: clipId,
    studentId: id,
    text,
    voiceId,
    filePath,
    sampleRate: audio.sampleRate,
    createdAt: now,
    updatedAt: now,
  });

  const [clip] = await db.select().from(speechClips).where(eq(speechClips.id, clipId));
  res.json({ ok: true, clip });
}

/**
 * GET /api/students/:id/speech
 * Returns the student's current greeting clip, or { clip: null }.
 */
export async function getStudentSpeech(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [clip] = await db.select().from(speechClips).where(eq(speechClips.studentId, id)).limit(1);
  res.json({ clip: clip ?? null });
}
