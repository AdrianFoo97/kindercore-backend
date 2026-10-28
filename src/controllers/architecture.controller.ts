import { Request, Response } from 'express';
import { ARCHITECTURE } from '../architecture/architecture.generated.js';

// GET /api/admin/architecture — the backend's layered structure (Routes →
// Controllers → Services → Tables), generated from the source by
// `npm run arch:gen` and compiled in, so it always matches the deployed code.
export async function getArchitecture(_req: Request, res: Response): Promise<void> {
  res.json(ARCHITECTURE);
}
