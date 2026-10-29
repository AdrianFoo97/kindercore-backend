import { Request, Response } from 'express';
import { getReaderKeyStatus, generateReaderKey, clearReaderKey } from '../services/readerKey.service.js';

// Settings → Attendance Reader (Admin/Superadmin). Manage the key the door
// RFID readers send as X-Reader-Key. The key itself is returned only by
// the generate call — afterwards only its last 4 characters are shown.

export async function getReaderKey(_req: Request, res: Response): Promise<void> {
  res.json(await getReaderKeyStatus());
}

export async function createReaderKey(_req: Request, res: Response): Promise<void> {
  if (process.env.ATTENDANCE_READER_KEY) {
    res.status(409).json({ message: 'The reader key is set by the server environment (ATTENDANCE_READER_KEY) and can only be changed there.' });
    return;
  }
  res.json(await generateReaderKey());
}

export async function deleteReaderKey(_req: Request, res: Response): Promise<void> {
  if (process.env.ATTENDANCE_READER_KEY) {
    res.status(409).json({ message: 'The reader key is set by the server environment (ATTENDANCE_READER_KEY) and can only be changed there.' });
    return;
  }
  res.json(await clearReaderKey());
}
