import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './auth.middleware.js';
import { checkReaderKey } from '../services/readerKey.service.js';

// Guards POST /api/attendance/scan, which two kinds of caller use:
//   • the physical RFID readers at the door — no user login, so they send
//     a shared secret in the `X-Reader-Key` header;
//   • staff in the app (Edit Student → test / back-fill a tap) — signed in,
//     so they send their normal login token.
// Without this, anyone who could send a card number could record attendance
// and get that child's name back.
//
// Enforced once a key is configured — generated in Settings → Attendance
// Reader, or the ATTENDANCE_READER_KEY env var (see readerKey.service.ts).
// Until then the endpoint stays open, so rolling this out doesn't stop the
// readers before they've been given the key; the server warns at startup.

export async function readerOrStaffMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const given = req.headers['x-reader-key'];
    const result = await checkReaderKey(typeof given === 'string' ? given : undefined);
    if (result === 'ok') { next(); return; }
    // A signed-in staff member — full sign-in check (account must still be active).
    if (req.headers.authorization?.startsWith('Bearer ')) {
      await authMiddleware(req, res, next);
      return;
    }
    if (result === 'unconfigured') { next(); return; }
    res.status(401).json({ message: 'Reader key required' });
  } catch (err) {
    next(err);
  }
}

export async function warnIfReaderKeyMissing(): Promise<void> {
  try {
    if ((await checkReaderKey(undefined)) === 'unconfigured') {
      console.warn(
        '[SECURITY] No attendance reader key is set — POST /api/attendance/scan is open to anyone. ' +
        'Generate one in Settings → Attendance Reader and configure each RFID reader to send it as the X-Reader-Key header.',
      );
    }
  } catch { /* startup warning only — never block boot */ }
}
