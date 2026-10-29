import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { systemSettings } from '../db/schema.js';

// The shared secret the door RFID readers send as `X-Reader-Key` when
// posting a scan. Two possible sources:
//   1. ATTENDANCE_READER_KEY env var — set on the server; takes precedence.
//   2. Settings → Attendance Reader — an admin generates it in the app. Only
//      a SHA-256 hash is stored (the key itself is shown once, at
//      generation), so reading the database doesn't reveal it.
// Neither set → "unconfigured": the scanner stays open (legacy behaviour).
//
// Stored under a `secret.` key: settings.controller never returns those
// from GET /api/settings and refuses to write them via the generic PATCH.

export const READER_KEY_SETTING = 'secret.attendance_reader_key';

interface StoredKey { hash: string; hint: string; createdAt: string }

export interface ReaderKeyStatus {
  configured: boolean;
  source: 'env' | 'settings' | null;
  /** Last 4 characters, to check which key a reader has. Settings-managed keys only. */
  hint: string | null;
  createdAt: string | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

async function readStored(): Promise<StoredKey | null> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, READER_KEY_SETTING)).limit(1);
  if (!row) return null;
  const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return v && typeof v.hash === 'string' ? (v as StoredKey) : null;
}

export async function getReaderKeyStatus(): Promise<ReaderKeyStatus> {
  if (process.env.ATTENDANCE_READER_KEY) return { configured: true, source: 'env', hint: null, createdAt: null };
  const stored = await readStored();
  return stored
    ? { configured: true, source: 'settings', hint: stored.hint, createdAt: stored.createdAt }
    : { configured: false, source: null, hint: null, createdAt: null };
}

/** Creates (or replaces) the key; returns it in plain text — the only time it's ever visible. */
export async function generateReaderKey(): Promise<{ key: string; status: ReaderKeyStatus }> {
  const key = `kcr_${randomBytes(24).toString('base64url')}`;
  const value: StoredKey = { hash: sha256(key).toString('hex'), hint: key.slice(-4), createdAt: new Date().toISOString() };
  const now = new Date();
  const [existing] = await db.select({ id: systemSettings.id }).from(systemSettings)
    .where(eq(systemSettings.key, READER_KEY_SETTING)).limit(1);
  if (existing) {
    await db.update(systemSettings).set({ value, updatedAt: now }).where(eq(systemSettings.id, existing.id));
  } else {
    await db.insert(systemSettings).values({
      id: randomUUID(), key: READER_KEY_SETTING, value, description: 'Attendance reader key (hashed)', updatedAt: now,
    });
  }
  return { key, status: await getReaderKeyStatus() };
}

export async function clearReaderKey(): Promise<ReaderKeyStatus> {
  await db.delete(systemSettings).where(eq(systemSettings.key, READER_KEY_SETTING));
  return getReaderKeyStatus();
}

/** 'ok' = matches the configured key; 'bad' = a key is configured and this isn't it; 'unconfigured' = none set. */
export async function checkReaderKey(given: string | undefined): Promise<'ok' | 'bad' | 'unconfigured'> {
  const envKey = process.env.ATTENDANCE_READER_KEY;
  // Compare SHA-256 digests: equal length always, so timingSafeEqual never
  // throws and the comparison time doesn't leak how much of the key matched.
  if (envKey) return given !== undefined && timingSafeEqual(sha256(given), sha256(envKey)) ? 'ok' : 'bad';
  const stored = await readStored();
  if (!stored) return 'unconfigured';
  return given !== undefined && timingSafeEqual(sha256(given), Buffer.from(stored.hash, 'hex')) ? 'ok' : 'bad';
}
