import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { leadsRouter } from './leads.routes.js';
import { googleRouter } from './google.routes.js';
import { settingsRouter } from './settings.routes.js';
import { packagesRouter } from './packages.routes.js';
import { studentsRouter } from './students.routes.js';
import { enrollmentsRouter } from './enrollments.routes.js';
import { adminRouter } from './admin.routes.js';
import { plannerRouter } from './planner.routes.js';
import { salaryRouter } from './salary.routes.js';
import { careerRouter } from './career.routes.js';
import { careerMissionsRouter } from './career-missions.routes.js';
import { missionCategoriesRouter } from './mission-categories.routes.js';
import { teacherAppraisalsRouter } from './teacher-appraisals.routes.js';
import { allowanceRouter } from './allowance.routes.js';
import { financeRouter } from './finance.routes.js';
import { operatingCostRouter } from './operatingCost.routes.js';
import { uploadRouter } from './upload.routes.js';
import { candidatesRouter } from './candidates.routes.js';
import { attendanceRouter } from './attendance.routes.js';
import { speechRouter } from './speech.routes.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Temporary: export Teacher rows as INSERT SQL (remove after use) ───────────
import { pool } from '../db/client.js';
router.get('/admin/export-teachers-sql', async (_req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows]: any = await conn.execute('SELECT * FROM `Teacher` ORDER BY `createdAt`');
    conn.release();

    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'number') return String(v);
      if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').slice(0, 23)}'`;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    };

    if (!rows.length) { res.type('text').send('-- No teachers'); return; }
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c: string) => `\`${c}\``).join(', ');
    const valueLines = rows.map((row: any, i: number) => {
      const vals = cols.map((c: string) => esc(row[c])).join(', ');
      return `  (${vals})${i < rows.length - 1 ? ',' : ';'}`;
    });
    const sql = [
      '-- Teacher seed exported from production',
      '-- Run on test DB: INSERT IGNORE skips rows that already exist',
      '',
      `INSERT IGNORE INTO \`Teacher\` (${colList}) VALUES`,
      ...valueLines,
    ].join('\n');

    res.type('text').send(sql);
  } catch (e: any) {
    res.status(500).send(`-- Error: ${e.message}`);
  }
});

router.use('/auth', authRouter);
router.use('/leads', leadsRouter);
router.use('/google', googleRouter);
router.use('/settings', settingsRouter);
router.use('/packages', packagesRouter);
router.use('/students', studentsRouter);
router.use('/enrollments', enrollmentsRouter);
router.use('/admin', adminRouter);
router.use('/planner', plannerRouter);
router.use('/salary', salaryRouter);
router.use('/finance', financeRouter);
router.use('/operating-cost', operatingCostRouter);
router.use('/upload', uploadRouter);
router.use('/candidates', candidatesRouter);
router.use('/', careerRouter);
router.use('/', careerMissionsRouter);
router.use('/', missionCategoriesRouter);
router.use('/', teacherAppraisalsRouter);
router.use('/', allowanceRouter);
router.use('/', attendanceRouter);
router.use('/', speechRouter);
