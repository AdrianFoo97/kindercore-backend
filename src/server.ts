import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { router } from './routes/index.js';
import { pool } from './db/client.js';

// ── Auto-migrate: create tables if missing, then add new columns ─────────────
async function runMigrations() {
  const createTables = [
    `CREATE TABLE IF NOT EXISTS \`User\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`email\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`passwordHash\` VARCHAR(191) NOT NULL,
      \`role\` ENUM('SUPERADMIN','ADMIN','STAFF') NOT NULL DEFAULT 'STAFF',
      \`inviteToken\` VARCHAR(191),
      \`inviteExpiresAt\` DATETIME(3),
      \`activated\` TINYINT(1) NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Lead\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`submittedAt\` DATETIME(3) NOT NULL,
      \`childName\` VARCHAR(191) NOT NULL,
      \`parentPhone\` VARCHAR(191) NOT NULL,
      \`childDob\` DATETIME(3) NOT NULL,
      \`enrolmentYear\` INT NOT NULL,
      \`status\` ENUM('NEW','CONTACTED','APPOINTMENT_BOOKED','FOLLOW_UP','ENROLLED','LOST','REJECTED') NOT NULL DEFAULT 'NEW',
      \`notes\` TEXT,
      \`appointmentStart\` DATETIME(3),
      \`appointmentEnd\` DATETIME(3),
      \`googleEventId\` VARCHAR(191),
      \`googleEventLink\` TEXT,
      \`appointmentCreatedByUserId\` VARCHAR(36),
      \`appointmentIsPlaceholder\` TINYINT(1) NOT NULL DEFAULT 0,
      \`attended\` TINYINT(1) NOT NULL DEFAULT 0,
      \`statusChangedAt\` DATETIME(3),
      \`lostReason\` TEXT,
      \`relationship\` VARCHAR(191),
      \`programme\` VARCHAR(191),
      \`preferredAppointmentTime\` VARCHAR(191),
      \`addressLocation\` VARCHAR(191),
      \`needsTransport\` TINYINT(1),
      \`howDidYouKnow\` VARCHAR(191),
      \`ctaSource\` VARCHAR(50),
      \`utmSource\` VARCHAR(191),
      \`leadTemperature\` ENUM('COOL','WARM','HOT'),
      \`deletedAt\` DATETIME(3),
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`GoogleConnection\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`accessToken\` TEXT NOT NULL,
      \`refreshToken\` TEXT NOT NULL,
      \`expiryDate\` BIGINT NOT NULL,
      \`scope\` TEXT NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`SystemSetting\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`key\` VARCHAR(191) NOT NULL,
      \`value\` JSON NOT NULL,
      \`description\` VARCHAR(191),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Package\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`year\` INT NOT NULL,
      \`programme\` VARCHAR(191) NOT NULL,
      \`age\` INT NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`price\` FLOAT,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Student\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`leadId\` VARCHAR(36) NOT NULL,
      \`enrolmentYear\` INT NOT NULL,
      \`enrolmentMonth\` INT NOT NULL,
      \`packageId\` VARCHAR(36) NOT NULL,
      \`enrolledAt\` DATETIME(3) NOT NULL,
      \`startDate\` DATETIME(3),
      \`notes\` TEXT,
      \`monthlyFee\` FLOAT,
      \`feeOverridden\` TINYINT(1) NOT NULL DEFAULT 0,
      \`ageOffset\` INT NOT NULL DEFAULT 0,
      \`childName\` VARCHAR(191),
      \`childDob\` DATETIME(3),
      \`onboardingProgress\` JSON,
      \`onboardingCompleted\` TINYINT(1) NOT NULL DEFAULT 0,
      \`withdrawnAt\` DATETIME(3),
      \`withdrawReason\` VARCHAR(191),
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Position\` (
      \`positionId\` VARCHAR(10) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`titleWeight\` INT NOT NULL DEFAULT 0,
      \`basicSalary\` FLOAT NOT NULL DEFAULT 0,
      \`maxLevel\` INT NOT NULL DEFAULT 5,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`positionId\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`LevelIncentive\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`positionId\` VARCHAR(10) NOT NULL,
      \`level\` INT NOT NULL,
      \`amount\` FLOAT NOT NULL DEFAULT 0,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Teacher\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`color\` VARCHAR(7) NOT NULL,
      \`isActive\` TINYINT(1) NOT NULL DEFAULT 1,
      \`allowedSubjectIds\` JSON,
      \`allowedClassroomIds\` JSON,
      \`workStartMinute\` INT,
      \`workEndMinute\` INT,
      \`workDays\` JSON,
      \`positionId\` VARCHAR(10),
      \`level\` INT DEFAULT 0,
      \`isFixedSalary\` TINYINT(1) NOT NULL DEFAULT 0,
      \`fixedSalaryAmount\` FLOAT,
      \`salaryType\` VARCHAR(20) DEFAULT 'formula',
      \`hourlyRate\` FLOAT,
      \`excludeFromProfitShare\` TINYINT(1) NOT NULL DEFAULT 0,
      \`overrideProfitShareWeight\` TINYINT(1) NOT NULL DEFAULT 0,
      \`customProfitShareWeight\` FLOAT,
      \`phone\` VARCHAR(50),
      \`employmentType\` VARCHAR(20) DEFAULT 'full-time',
      \`resignedAt\` DATETIME(3),
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`AllowanceType\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`isDefault\` TINYINT(1) NOT NULL DEFAULT 0,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`TeacherAllowance\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`teacherId\` VARCHAR(36) NOT NULL,
      \`allowanceTypeId\` VARCHAR(36) NOT NULL,
      \`amount\` FLOAT NOT NULL DEFAULT 0,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`CareerRecord\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`teacherId\` VARCHAR(36) NOT NULL,
      \`positionId\` VARCHAR(10) NOT NULL,
      \`level\` INT NOT NULL DEFAULT 0,
      \`effectiveDate\` DATETIME(3) NOT NULL,
      \`notes\` TEXT,
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`OperatingCostCategoryGroup\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`isProtected\` TINYINT(1) NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`OperatingCostCategory\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`groupId\` VARCHAR(36) NOT NULL,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`defaultAmount\` FLOAT,
      \`monthlyBudget\` FLOAT,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`OperatingCost\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`year\` INT NOT NULL,
      \`month\` INT NOT NULL,
      \`categoryId\` VARCHAR(36) NOT NULL,
      \`amount\` FLOAT NOT NULL DEFAULT 0,
      \`notes\` TEXT,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Classroom\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`capacity\` INT,
      \`startMinute\` INT,
      \`endMinute\` INT,
      \`daysOfWeek\` JSON,
      \`isActive\` TINYINT(1) NOT NULL DEFAULT 1,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`Subject\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`color\` VARCHAR(7) NOT NULL,
      \`lessonsPerWeek\` INT,
      \`defaultDuration\` INT DEFAULT 60,
      \`classLessons\` JSON,
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`PlannerTask\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`category\` ENUM('TEACHING','ADMIN','DUTY','BREAK','OTHER') NOT NULL,
      \`color\` VARCHAR(7) NOT NULL,
      \`defaultDuration\` INT NOT NULL DEFAULT 30,
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`ScheduleBlock\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`weekDate\` DATETIME(3) NOT NULL,
      \`dayOfWeek\` INT NOT NULL,
      \`startMinute\` INT NOT NULL,
      \`durationMinutes\` INT NOT NULL DEFAULT 30,
      \`teacherId\` VARCHAR(36),
      \`subjectId\` VARCHAR(36),
      \`taskId\` VARCHAR(36),
      \`classroomId\` VARCHAR(36),
      \`assignedTeacherIds\` JSON,
      \`notes\` TEXT,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`SavedTimetable\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`blocks\` JSON NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    )`,
  ];

  const addColumns = [
    // Teacher — planner fields
    `ALTER TABLE \`Teacher\` ADD COLUMN \`allowedSubjectIds\` JSON NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`allowedClassroomIds\` JSON NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`workStartMinute\` INT NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`workEndMinute\` INT NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`workDays\` JSON NULL`,
    // Teacher — salary fields
    `ALTER TABLE \`Teacher\` ADD COLUMN \`positionId\` VARCHAR(10) NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`level\` INT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`isFixedSalary\` TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`fixedSalaryAmount\` FLOAT NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`salaryType\` VARCHAR(20) NULL DEFAULT 'formula'`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`hourlyRate\` FLOAT NULL`,
    // Teacher — HR / profit-share fields
    `ALTER TABLE \`Teacher\` ADD COLUMN \`excludeFromProfitShare\` TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`overrideProfitShareWeight\` TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`customProfitShareWeight\` FLOAT NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`phone\` VARCHAR(50) NULL`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`employmentType\` VARCHAR(20) NULL DEFAULT 'full-time'`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`resignedAt\` DATETIME(3) NULL`,
    // OperatingCostCategoryGroup
    `ALTER TABLE \`OperatingCostCategoryGroup\` ADD COLUMN \`isProtected\` TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`hasEpf\` TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`hasSocso\` TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`hasEis\` TINYINT(1) NOT NULL DEFAULT 1`,
  ];

  const conn = await pool.getConnection();
  try {
    // Phase 1: create tables
    for (const sql of createTables) {
      await conn.execute(sql);
    }
    console.log('[migrate] Tables verified (CREATE IF NOT EXISTS)');

    // Phase 2: add new columns (idempotent — skip if already exists)
    for (const sql of addColumns) {
      try {
        await conn.execute(sql);
        const col = sql.match(/ADD COLUMN `(\w+)`/)?.[1];
        if (col) console.log(`[migrate] Added column: ${col}`);
      } catch (e: any) {
        if (e.code !== 'ER_DUP_FIELDNAME') throw e;
      }
    }

    // Phase 3: seed default category groups & categories if none exist
    const [[{ cnt }]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM \`OperatingCostCategoryGroup\``) as any;
    if (Number(cnt) === 0) {
      const G_ADMIN = 'oc-group-0001-0000-0000-000000000001';
      const G_SALES = 'oc-group-0002-0000-0000-000000000002';
      const G_HR    = 'oc-group-0003-0000-0000-000000000003';

      await conn.execute(`INSERT IGNORE INTO \`OperatingCostCategoryGroup\` (\`id\`,\`name\`,\`sortOrder\`,\`isProtected\`,\`createdAt\`,\`updatedAt\`) VALUES
        ('${G_ADMIN}', 'Administrative',       10, 0, NOW(3), NOW(3)),
        ('${G_SALES}', 'Sales & Distribution', 20, 0, NOW(3), NOW(3)),
        ('${G_HR}',    'HR Benefits',          30, 1, NOW(3), NOW(3))`);

      await conn.execute(`INSERT IGNORE INTO \`OperatingCostCategory\` (\`id\`,\`name\`,\`groupId\`,\`sortOrder\`,\`createdAt\`,\`updatedAt\`) VALUES
        ('oc-cat-adm-001','Tel, Fax, H/P and Internet',  '${G_ADMIN}', 10,  NOW(3),NOW(3)),
        ('oc-cat-adm-002','Printing & Stationery',        '${G_ADMIN}', 20,  NOW(3),NOW(3)),
        ('oc-cat-adm-003','Postage & Courier',            '${G_ADMIN}', 30,  NOW(3),NOW(3)),
        ('oc-cat-adm-004','Toll & Parking',               '${G_ADMIN}', 40,  NOW(3),NOW(3)),
        ('oc-cat-adm-005','Petrol',                       '${G_ADMIN}', 50,  NOW(3),NOW(3)),
        ('oc-cat-adm-006','Upkeep of Motor Vehicle',      '${G_ADMIN}', 60,  NOW(3),NOW(3)),
        ('oc-cat-adm-007','Upkeep of Office Equipment',   '${G_ADMIN}', 70,  NOW(3),NOW(3)),
        ('oc-cat-adm-008','Upkeep of Office',             '${G_ADMIN}', 80,  NOW(3),NOW(3)),
        ('oc-cat-adm-009','Rental',                       '${G_ADMIN}', 90,  NOW(3),NOW(3)),
        ('oc-cat-adm-010','Water Filter',                 '${G_ADMIN}',100,  NOW(3),NOW(3)),
        ('oc-cat-adm-011','Road Tax & Insurance',         '${G_ADMIN}',110,  NOW(3),NOW(3)),
        ('oc-cat-adm-012','Assessment & Quit Rent',       '${G_ADMIN}',120,  NOW(3),NOW(3)),
        ('oc-cat-adm-013','License Fee / Stamping Fee',   '${G_ADMIN}',130,  NOW(3),NOW(3)),
        ('oc-cat-adm-014','Waste Collection',             '${G_ADMIN}',140,  NOW(3),NOW(3)),
        ('oc-cat-adm-015','Bank Charges',                 '${G_ADMIN}',150,  NOW(3),NOW(3)),
        ('oc-cat-adm-016','Depreciation of Fixed Assets', '${G_ADMIN}',160,  NOW(3),NOW(3)),
        ('oc-cat-adm-017','Secretary Fee',                '${G_ADMIN}',170,  NOW(3),NOW(3)),
        ('oc-cat-adm-018','Cleaning Expenses',            '${G_ADMIN}',180,  NOW(3),NOW(3)),
        ('oc-cat-adm-019','Bank Interest',                '${G_ADMIN}',190,  NOW(3),NOW(3)),
        ('oc-cat-sal-001','Event Fee',                    '${G_SALES}', 10,  NOW(3),NOW(3)),
        ('oc-cat-sal-002','Training Fee',                 '${G_SALES}', 20,  NOW(3),NOW(3)),
        ('oc-cat-sal-003','Advertisement',                '${G_SALES}', 30,  NOW(3),NOW(3)),
        ('oc-cat-sal-004','Travelling',                   '${G_SALES}', 40,  NOW(3),NOW(3)),
        ('oc-cat-sal-005','Transportation',               '${G_SALES}', 50,  NOW(3),NOW(3)),
        ('oc-cat-sal-006','Subscription Fee',             '${G_SALES}', 60,  NOW(3),NOW(3)),
        ('oc-cat-sal-007','Photoshoot',                   '${G_SALES}', 70,  NOW(3),NOW(3)),
        ('oc-cat-hr-001', 'EPF',                          '${G_HR}',    10,  NOW(3),NOW(3)),
        ('oc-cat-hr-002', 'SOCSO',                        '${G_HR}',    20,  NOW(3),NOW(3)),
        ('oc-cat-hr-003', 'EIS',                          '${G_HR}',    30,  NOW(3),NOW(3)),
        ('oc-cat-hr-004', 'Medical Benefits',             '${G_HR}',    40,  NOW(3),NOW(3)),
        ('oc-cat-hr-005', 'Staff Welfare',                '${G_HR}',    50,  NOW(3),NOW(3))`);

      console.log('[migrate] Seeded default operating cost groups and categories');
    }

    // Phase 4: backfill initial career records so every teacher's position
    // history starts at their join date. Done via two lookups + in-memory
    // reconciliation to avoid cross-table JOIN collation issues.
    const [allTeacherRows] = await conn.execute<any[]>(
      `SELECT id, positionId, level, createdAt FROM \`Teacher\`
       WHERE positionId IS NOT NULL AND createdAt IS NOT NULL`
    );
    const [earliestRows] = await conn.execute<any[]>(
      `SELECT teacherId, MIN(effectiveDate) AS earliest
       FROM \`CareerRecord\` GROUP BY teacherId`
    );
    const earliestByTeacher = new Map<string, Date>();
    for (const r of earliestRows) earliestByTeacher.set(r.teacherId, new Date(r.earliest));
    let seededCount = 0;
    for (const t of allTeacherRows) {
      const joinDate = new Date(t.createdAt);
      const earliest = earliestByTeacher.get(t.id);
      if (earliest && earliest <= joinDate) continue; // already covered
      const recordId = `car-${String(t.id).substring(0, 8)}-seed-${Date.now().toString(36)}-${seededCount}`;
      await conn.execute(
        `INSERT INTO \`CareerRecord\` (id, teacherId, positionId, level, effectiveDate, notes, createdAt)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        [recordId, t.id, t.positionId, t.level ?? 0, joinDate, joinDate],
      );
      seededCount++;
    }
    if (seededCount > 0) {
      console.log(`[migrate] Seeded initial CareerRecord for ${seededCount} teacher(s)`);
    }

    // Phase 5: reconcile pre-existing lost-reason strings with the current
    // system-pinned labels. Each mapping rewrites historical strings — on any
    // fresh deployment the UPDATE is a no-op.
    const LOST_REASON_RENAMES: [from: string, to: string][] = [
      ["Didn't reply",                              'No response or declined appointment'],
      ["Didn't reply or didn't want appointment",   'No response or declined appointment'],
      ["Didn't attend the enquiry",                 'Missed appointment'],
      ["Didn't attend",                             'Missed appointment'],
    ];
    for (const [from, to] of LOST_REASON_RENAMES) {
      const [res] = await conn.execute<any>(
        `UPDATE \`Lead\` SET \`lostReason\` = ? WHERE \`lostReason\` = ?`,
        [to, from],
      );
      if (res?.affectedRows > 0) {
        console.log(`[migrate] Renamed ${res.affectedRows} Lead(s) lostReason: "${from}" → "${to}"`);
      }
    }
    // Phase 5b: backfill LOST / REJECTED leads that have no stored reason.
    // The prior version of updateLead wiped lostReason whenever status moved
    // away from LOST — including transitions to REJECTED — so historical
    // REJECTED rows ended up with null reasons. A placeholder preserves the
    // "every rejected lead has a reason" invariant without inventing detail
    // we don't actually have.
    const [backfilled] = await conn.execute<any>(
      `UPDATE \`Lead\`
       SET \`lostReason\` = 'Reason not recorded'
       WHERE \`status\` IN ('LOST', 'REJECTED')
         AND (\`lostReason\` IS NULL OR \`lostReason\` = '')`,
    );
    if (backfilled?.affectedRows > 0) {
      console.log(`[migrate] Backfilled ${backfilled.affectedRows} LOST/REJECTED lead(s) with placeholder reason`);
    }

    // Strip any obsolete/renamed entries from the settings lost_reasons list
    // so the two sources of truth agree. `getSettings` normalizes system
    // labels back in on read, so it's safe to drop them here.
    const obsoleteLabels = new Set<string>([
      "Didn't reply",
      "Didn't reply or didn't want appointment",
      "Didn't attend the enquiry",
      "Didn't attend",
    ]);
    const [[settingRow]] = await conn.execute<any[]>(
      `SELECT \`value\` FROM \`SystemSetting\` WHERE \`key\` = 'lost_reasons'`,
    );
    if (settingRow?.value) {
      try {
        const parsed = typeof settingRow.value === 'string'
          ? JSON.parse(settingRow.value)
          : settingRow.value;
        if (Array.isArray(parsed) && parsed.some(r => obsoleteLabels.has(String(r)))) {
          const cleaned = parsed.filter((r: unknown) => !obsoleteLabels.has(String(r)));
          await conn.execute(
            `UPDATE \`SystemSetting\` SET \`value\` = ?, \`updatedAt\` = NOW(3) WHERE \`key\` = 'lost_reasons'`,
            [JSON.stringify(cleaned)],
          );
          console.log(`[migrate] Removed obsolete lost_reasons entries from settings`);
        }
      } catch {
        // malformed JSON — getSettings normalizes it back into shape on read
      }
    }
  } finally {
    conn.release();
  }
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ?? 4000;
const isProd = process.env.NODE_ENV === 'production';

// ── Security headers ──
app.use(helmet());

// ── CORS ──
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const allowedOrigins = [frontendUrl];
if (frontendUrl.includes('://') && !frontendUrl.includes('localhost')) {
  const url = new URL(frontendUrl);
  if (url.hostname.startsWith('www.')) {
    allowedOrigins.push(frontendUrl.replace('://www.', '://'));
  } else {
    allowedOrigins.push(frontendUrl.replace('://', '://www.'));
  }
}
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// ── Body size limit ──
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 min per IP
  message: { message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

const leadCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 enquiries per hour per IP
  message: { message: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/leads', (req, _res, next) => {
  // Only rate-limit unauthenticated POST (public enquiry form); skip for logged-in users (imports)
  if (req.method === 'POST' && req.path === '/' && !req.headers.authorization) return leadCreateLimiter(req, _res, next);
  next();
});

// ── Request logging ──
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    if (status >= 500) {
      console.log(`[ERROR] ${method} ${originalUrl} ${status} ${ms}ms`);
    } else if (status >= 400) {
      console.log(`[WARNING] ${method} ${originalUrl} ${status} ${ms}ms`);
    } else {
      console.log(`${method} ${originalUrl} ${status} ${ms}ms`);
    }
  });

  next();
});

// ── SSE: real-time event stream ──
import { sseClients } from './sse.js';

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n'); // heartbeat
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── Routes ──
app.use('/api', router);

// ── Global error handler ──
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const timestamp = new Date().toISOString();
  const { method, originalUrl, ip } = req;

  // Detect database connection errors
  const isDbError = /ECONNREFUSED|ETIMEDOUT|ER_ACCESS_DENIED|PROTOCOL_CONNECTION_LOST|ER_BAD_DB_ERROR|ENOTFOUND|connect ECONN/i.test(err.message);

  if (isDbError) {
    console.log(`[ERROR] ${timestamp} DB_UNAVAILABLE | ${method} ${originalUrl} | IP: ${ip} | ${err.message}`);
    res.status(503).json({ message: 'Service temporarily unavailable. Please try again shortly.', code: 'DB_UNAVAILABLE' });
    return;
  }

  // Log full stack for 500 errors
  console.log(`[ERROR] ${timestamp} INTERNAL_ERROR | ${method} ${originalUrl} | IP: ${ip}`);
  console.log(err.stack ?? err.message);

  res.status(500).json({ message: isProd ? 'Something went wrong. Please try again.' : err.message, code: 'INTERNAL_ERROR' });
});

runMigrations()
  .then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[backend] Server running on http://localhost:${PORT}`);
      const dbUrl = process.env.DATABASE_URL ?? '(not set)';
      const masked = dbUrl.replace(/:([^:@]+)@/, ':****@');
      console.log(`[backend] DATABASE_URL: ${masked}`);
    });
  })
  .catch(err => {
    console.error('[migrate] Failed to run migrations:', err.message);
    process.exit(1);
  });
