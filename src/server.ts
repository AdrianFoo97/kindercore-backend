import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { router } from './routes/index.js';
import { pool } from './db/client.js';
import { SYSTEM_LOST_REASONS } from './constants/lostReasons.js';

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
      \`rfid\` VARCHAR(50),
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`Student_rfid_uq\` (\`rfid\`)
    )`,
    // Attendance log — one row per RFID scan (or manual entry).
    `CREATE TABLE IF NOT EXISTS \`StudentAttendance\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`studentId\` VARCHAR(36) NOT NULL,
      \`scannedAt\` DATETIME(3) NOT NULL,
      \`source\` VARCHAR(20) NOT NULL DEFAULT 'rfid',
      \`notes\` TEXT,
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`StudentAttendance_studentId_idx\` (\`studentId\`),
      INDEX \`StudentAttendance_scannedAt_idx\` (\`scannedAt\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // Per-period enrollment history. Each row owns the package + monthly fee
    // for a contiguous period of the student's life. The row with
    // `endDate IS NULL` is the current enrollment.
    //
    // Collation MUST match the older Student table's `utf8mb4_unicode_ci`,
    // otherwise comparing `e.studentId = s.id` across the two tables throws
    // "Illegal mix of collations" on MySQL 8 (whose default is the newer
    // `utf8mb4_0900_ai_ci`).
    `CREATE TABLE IF NOT EXISTS \`StudentEnrollment\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`studentId\` VARCHAR(36) NOT NULL,
      \`packageId\` VARCHAR(36) NOT NULL,
      \`monthlyFee\` FLOAT NOT NULL,
      \`feeOverridden\` TINYINT(1) NOT NULL DEFAULT 0,
      \`startDate\` DATETIME(3) NOT NULL,
      \`endDate\` DATETIME(3),
      \`reason\` VARCHAR(191),
      \`createdAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`StudentEnrollment_studentId_idx\` (\`studentId\`),
      INDEX \`StudentEnrollment_period_idx\` (\`studentId\`, \`startDate\`, \`endDate\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`Position\` (
      \`positionId\` VARCHAR(10) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`titleWeight\` INT NOT NULL DEFAULT 0,
      \`basicSalary\` FLOAT NOT NULL DEFAULT 0,
      \`maxLevel\` INT NOT NULL DEFAULT 5,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`inCareerProgression\` TINYINT(1) NOT NULL DEFAULT 1,
      \`badgeUrl\` VARCHAR(500),
      \`starColor\` VARCHAR(20),
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
    `CREATE TABLE IF NOT EXISTS \`MissionCategory\` (
      \`code\` VARCHAR(50) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`achievementName\` VARCHAR(191) NOT NULL,
      \`description\` TEXT,
      \`icon\` VARCHAR(50) NOT NULL,
      \`color\` VARCHAR(20) NOT NULL,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`code\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`CareerMission\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`positionId\` VARCHAR(10) NOT NULL,
      \`title\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(50) NOT NULL,
      \`description\` TEXT,
      \`whyItMatters\` TEXT,
      \`difficulty\` ENUM('BASIC','INTERMEDIATE','ADVANCED') NOT NULL DEFAULT 'BASIC',
      \`evidenceRequirements\` TEXT,
      \`required\` TINYINT(1) NOT NULL DEFAULT 1,
      \`highPriority\` TINYINT(1) NOT NULL DEFAULT 0,
      \`requiresApproval\` TINYINT(1) NOT NULL DEFAULT 1,
      \`displayOrder\` INT NOT NULL DEFAULT 0,
      \`deletedAt\` DATETIME(3),
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`CareerMission_positionId_idx\` (\`positionId\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`TeacherAppraisal\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`teacherId\` VARCHAR(36) NOT NULL,
      \`year\` INT NOT NULL,
      \`month\` INT NOT NULL,
      \`score\` FLOAT NOT NULL,
      \`notes\` TEXT,
      \`evaluatedBy\` VARCHAR(191),
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`TeacherAppraisal_period_uq\` (\`teacherId\`, \`year\`, \`month\`),
      INDEX \`TeacherAppraisal_teacherId_idx\` (\`teacherId\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`TeacherMissionProgress\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`teacherId\` VARCHAR(36) NOT NULL,
      \`missionId\` VARCHAR(36) NOT NULL,
      \`status\` ENUM('PENDING','IN_PROGRESS','UNDER_REVIEW','COMPLETED') NOT NULL DEFAULT 'PENDING',
      \`evidenceCount\` INT NOT NULL DEFAULT 0,
      \`evidenceTotal\` INT NOT NULL DEFAULT 0,
      \`notes\` TEXT,
      \`startedAt\` DATETIME(3),
      \`submittedAt\` DATETIME(3),
      \`approvedAt\` DATETIME(3),
      \`approvedBy\` VARCHAR(36),
      \`createdAt\` DATETIME(3) NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`TMP_teacher_mission_uq\` (\`teacherId\`, \`missionId\`),
      INDEX \`TMP_teacherId_idx\` (\`teacherId\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
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
    `CREATE TABLE IF NOT EXISTS \`Candidate\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`submittedAt\` DATETIME(3) NOT NULL,
      \`fullName\` VARCHAR(191) NOT NULL,
      \`phone\` VARCHAR(50) NOT NULL,
      \`dob\` DATETIME(3) NULL,
      \`addressLocation\` VARCHAR(191) NULL,
      \`commuteTime\` ENUM('UNDER_15','MIN_15_30','MIN_30_45','MIN_45_60','OVER_60','WILL_MOVE') NULL,
      \`desiredPosition\` VARCHAR(191) NULL,
      \`expectedSalary\` FLOAT NULL,
      \`availableFrom\` DATETIME(3) NULL,
      \`preferredStartDate\` DATETIME(3) NULL,
      \`experienceRange\` VARCHAR(191) NULL,
      \`qualification\` VARCHAR(191) NULL,
      \`qualificationOther\` VARCHAR(191) NULL,
      \`salaryJustification\` TEXT NULL,
      \`careerGoals\` TEXT NULL,
      \`whyKindergartenTeacher\` TEXT NULL,
      \`resumePath\` VARCHAR(500) NULL,
      \`resumeOriginalName\` VARCHAR(255) NULL,
      \`howDidYouKnow\` VARCHAR(191) NULL,
      \`status\` ENUM('NEW','CONTACTED','INTERVIEWING','HIRED','REJECTED') NOT NULL DEFAULT 'NEW',
      \`isShortlisted\` TINYINT(1) NOT NULL DEFAULT 0,
      \`statusChangedAt\` DATETIME(3) NULL,
      \`interviewStart\` DATETIME(3) NULL,
      \`interviewEnd\` DATETIME(3) NULL,
      \`interviewLocation\` VARCHAR(191) NULL,
      \`interviewNotes\` TEXT NULL,
      \`rejectionReason\` TEXT NULL,
      \`hiredAt\` DATETIME(3) NULL,
      \`notes\` TEXT NULL,
      \`deletedAt\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_candidate_status\` (\`status\`),
      INDEX \`idx_candidate_desiredPosition\` (\`desiredPosition\`)
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
    // Lead — explicit analytics columns (source of truth for classifiers)
    `ALTER TABLE \`Lead\` ADD COLUMN \`isQualified\` TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE \`Lead\` ADD COLUMN \`visitOutcome\` ENUM('ATTENDED','NO_SHOW') DEFAULT NULL`,
    // Career progression columns
    `ALTER TABLE \`Position\` ADD COLUMN \`inCareerProgression\` TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE \`Position\` ADD COLUMN \`badgeUrl\` VARCHAR(500) NULL`,
    `ALTER TABLE \`Position\` ADD COLUMN \`starColor\` VARCHAR(20) NULL`,
    `ALTER TABLE \`CareerMission\` ADD COLUMN \`whyItMatters\` TEXT`,
    `ALTER TABLE \`CareerMission\` ADD COLUMN \`highPriority\` TINYINT(1) NOT NULL DEFAULT 0`,
    // Candidate — columns added AFTER the initial CREATE TABLE. CREATE TABLE
    // IF NOT EXISTS is a no-op if the table is already there, so any DB that
    // ran an earlier version of this branch is missing these. Each ADD is
    // idempotent via the ER_DUP_FIELDNAME catch below.
    `ALTER TABLE \`Candidate\` ADD COLUMN \`commuteTime\` ENUM('UNDER_15','MIN_15_30','MIN_30_45','MIN_45_60','OVER_60','WILL_MOVE') NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`desiredPosition\` VARCHAR(191) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`preferredStartDate\` DATETIME(3) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`experienceRange\` VARCHAR(191) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`qualificationOther\` VARCHAR(191) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`resumePath\` VARCHAR(500) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`resumeOriginalName\` VARCHAR(255) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`careerGoals\` TEXT NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`whyKindergartenTeacher\` TEXT NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`salaryJustification\` TEXT NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`isShortlisted\` TINYINT(1) NOT NULL DEFAULT 0`,
    // Google Calendar bookkeeping — added later; older test/prod DBs
    // don't have them so INSERT/SELECT would fail without these.
    `ALTER TABLE \`Candidate\` ADD COLUMN \`interviewEventId\` VARCHAR(191) NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`interviewEventLink\` TEXT NULL`,
    `ALTER TABLE \`Candidate\` ADD COLUMN \`interviewCalendarId\` VARCHAR(191) NULL`,
    // Admin's private notes — separate from the candidate-visible
    // `notes` field. Also missed the initial CREATE TABLE.
    `ALTER TABLE \`Candidate\` ADD COLUMN \`adminNotes\` TEXT NULL`,
    // Which channel the application arrived through
    // (apply_form / google_form / null-legacy).
    `ALTER TABLE \`Candidate\` ADD COLUMN \`submissionSource\` VARCHAR(32) NULL`,
    // Marketing attribution — utm_source from the apply URL query.
    `ALTER TABLE \`Candidate\` ADD COLUMN \`utmSource\` VARCHAR(191) NULL`,
    // External resume URL — populated by the Google Form / Apps Script
    // bridge because Drive-hosted resumes can't live in resumePath.
    `ALTER TABLE \`Candidate\` ADD COLUMN \`resumeUrl\` TEXT NULL`,
    // Mission target — teacher-pinned focus flag for the Career page's
    // "Current Targets" list. Independent of status.
    `ALTER TABLE \`TeacherMissionProgress\` ADD COLUMN \`isTargeted\` TINYINT(1) NOT NULL DEFAULT 0`,
    // RFID + attendance — added later, top up older databases.
    `ALTER TABLE \`Student\` ADD COLUMN \`rfid\` VARCHAR(50) NULL`,
    `ALTER TABLE \`Student\` ADD UNIQUE KEY \`Student_rfid_uq\` (\`rfid\`)`,
    // AllowanceType — admin-configurable icon and guarantee status.
    // Drives the Compensation page's per-card icon + status badge.
    `ALTER TABLE \`AllowanceType\` ADD COLUMN \`icon\` VARCHAR(50) NOT NULL DEFAULT 'gift'`,
    `ALTER TABLE \`AllowanceType\` ADD COLUMN \`isGuaranteed\` TINYINT(1) NOT NULL DEFAULT 1`,
    // Hierarchy — parent allowance type (null = top-level). Used to
    // group sub-types like Training Completion under Other Allowance.
    `ALTER TABLE \`AllowanceType\` ADD COLUMN \`parentId\` VARCHAR(36) NULL`,
    // Position description — free-form text shown on the position edit
    // page and on the teacher-facing career journey to explain what the
    // rank represents.
    `ALTER TABLE \`Position\` ADD COLUMN \`description\` TEXT NULL`,
    // Position role focus — short headline (e.g. "Overall School
    // Management") that captures the rank's main responsibility.
    // Shown bolded above the description on the teacher career page.
    `ALTER TABLE \`Position\` ADD COLUMN \`roleFocus\` VARCHAR(191) NULL`,
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
        const key = sql.match(/ADD (?:UNIQUE )?(?:KEY|INDEX) `(\w+)`/)?.[1];
        if (col) console.log(`[migrate] Added column: ${col}`);
        else if (key) console.log(`[migrate] Added index: ${key}`);
      } catch (e: any) {
        // ER_DUP_FIELDNAME = column already exists
        // ER_DUP_KEYNAME    = index/key already exists
        if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_DUP_KEYNAME') throw e;
      }
    }

    // Phase 2b: ensure Lead.status enum includes every value the code uses.
    // Some deployments were created before REJECTED was added — in non-strict
    // sql_mode MySQL silently stores invalid enum values as empty string,
    // which is why PATCHes to 'REJECTED' land as status="" with no error.
    // MODIFY COLUMN is idempotent: if the enum is already correct, it's a
    // no-op. We follow up by repairing any rows that already ended up as "".
    try {
      await conn.execute(
        `ALTER TABLE \`Lead\` MODIFY \`status\`
         ENUM('NEW','CONTACTED','APPOINTMENT_BOOKED','FOLLOW_UP','ENROLLED','LOST','REJECTED')
         NOT NULL DEFAULT 'NEW'`,
      );
      console.log('[migrate] Verified Lead.status enum includes all 7 values');
    } catch (e: any) {
      console.warn('[migrate] Failed to enforce Lead.status enum:', e.message);
    }

    // Same pattern for Candidate.status — CREATE TABLE went out with an
    // older 5-value enum (NEW/CONTACTED/INTERVIEWING/HIRED/REJECTED).
    // Newer pipeline stages PENDING_DECISION + OFFER_SENT would silently
    // land as empty string under non-strict sql_mode without this.
    try {
      await conn.execute(
        `ALTER TABLE \`Candidate\` MODIFY \`status\`
         ENUM('NEW','CONTACTED','INTERVIEWING','PENDING_DECISION','OFFER_SENT','HIRED','REJECTED')
         NOT NULL DEFAULT 'NEW'`,
      );
      console.log('[migrate] Verified Candidate.status enum includes all 7 values');
    } catch (e: any) {
      console.warn('[migrate] Failed to enforce Candidate.status enum:', e.message);
    }
    const [statusRepair] = await conn.execute<any>(
      `UPDATE \`Lead\`
       SET \`status\` = CASE
         WHEN \`lostReason\` IS NOT NULL AND \`lostReason\` <> '' THEN 'REJECTED'
         ELSE 'NEW'
       END
       WHERE \`status\` = ''`,
    );
    if (statusRepair?.affectedRows > 0) {
      console.log(`[migrate] Repaired ${statusRepair.affectedRows} Lead(s) with empty status (routed to REJECTED if lostReason set, else NEW)`);
    }

    // Phase 2c: backfill Lead.attended for rows whose status already
    // implies the visit happened. The older markAttendance flow set
    // status='FOLLOW_UP' without flipping the attended flag, leaving
    // real visits miscounted as no-shows in the Marketing analysis.
    const [attendedBackfill] = await conn.execute<any>(
      `UPDATE \`Lead\` SET \`attended\` = 1
       WHERE \`status\` IN ('FOLLOW_UP', 'ENROLLED')
         AND (\`attended\` IS NULL OR \`attended\` = 0)`,
    );
    if (attendedBackfill?.affectedRows > 0) {
      console.log(`[migrate] Backfilled attended=true for ${attendedBackfill.affectedRows} FOLLOW_UP/ENROLLED Lead(s)`);
    }

    // Phase 2d: backfill the new explicit analytics columns from existing
    // status + lostReason + attended state. Any system reason whose role
    // isn't 'no_show' unqualifies the lead (cold, not_fit, ...). NO_SHOW
    // is intentionally left unset for pending rows — the classifier derives
    // it at query time from `appointmentStart < now`. Updates are idempotent.
    const unqualifyingSystemLabels = SYSTEM_LOST_REASONS
      .filter(r => r.role !== 'no_show')
      .map(r => r.label);
    const [qualifiedBackfill] = await conn.execute<any>(
      `UPDATE \`Lead\`
       SET \`isQualified\` = CASE
         WHEN \`status\` = 'REJECTED' THEN 0
         WHEN \`status\` = 'LOST' AND \`lostReason\` IN (${unqualifyingSystemLabels.map(() => '?').join(',')}) THEN 0
         ELSE 1
       END`,
      unqualifyingSystemLabels,
    );
    if (qualifiedBackfill?.affectedRows > 0) {
      console.log(`[migrate] Backfilled isQualified for ${qualifiedBackfill.affectedRows} Lead(s)`);
    }
    // Partition system labels by role — drives the three backfill cases.
    const noShowLabels = SYSTEM_LOST_REASONS.filter(r => r.role === 'no_show').map(r => r.label);
    const unqualifyingLabels = SYSTEM_LOST_REASONS.filter(r => r.role !== 'no_show').map(r => r.label);

    // NO_SHOW: LOST with a no_show system reason (Missed appointment).
    if (noShowLabels.length > 0) {
      const [visitNoShowBackfill] = await conn.execute<any>(
        `UPDATE \`Lead\`
         SET \`visitOutcome\` = 'NO_SHOW'
         WHERE \`status\` = 'LOST'
           AND \`lostReason\` IN (${noShowLabels.map(() => '?').join(',')})
           AND (\`visitOutcome\` IS NULL OR \`visitOutcome\` <> 'NO_SHOW')`,
        noShowLabels,
      );
      if (visitNoShowBackfill?.affectedRows > 0) {
        console.log(`[migrate] Backfilled visitOutcome='NO_SHOW' for ${visitNoShowBackfill.affectedRows} Lead(s)`);
      }
    }

    // ATTENDED: visit clearly happened — FOLLOW_UP, ENROLLED, or LOST with
    // a user-defined reason (anything not in the system unqualifying /
    // no_show sets). A concrete lost reason implies the lead engaged with
    // us enough to give one; treat it as attended for analytics so the
    // Leads Detail pill no longer shows "Pending" on terminal losses.
    const atAllSystem = [...noShowLabels, ...unqualifyingLabels];
    const atParams = atAllSystem.length > 0 ? atAllSystem : ['__never__'];
    const atPlaceholders = atParams.map(() => '?').join(',');
    const [visitAttendedBackfill] = await conn.execute<any>(
      `UPDATE \`Lead\`
       SET \`visitOutcome\` = 'ATTENDED'
       WHERE (
         \`status\` IN ('FOLLOW_UP', 'ENROLLED')
         OR (\`status\` = 'LOST' AND (\`lostReason\` IS NULL OR \`lostReason\` NOT IN (${atPlaceholders})))
       )
       AND (\`visitOutcome\` IS NULL OR \`visitOutcome\` <> 'ATTENDED')`,
      atParams,
    );
    if (visitAttendedBackfill?.affectedRows > 0) {
      console.log(`[migrate] Backfilled visitOutcome='ATTENDED' for ${visitAttendedBackfill.affectedRows} Lead(s)`);
    }

    // NULL: LOST with an unqualifying system reason — isQualified=false
    // handles the classification; visitOutcome stays NULL. Force any prior
    // value back to NULL so re-running after a role change cleans up.
    if (unqualifyingLabels.length > 0) {
      const [visitClearBackfill] = await conn.execute<any>(
        `UPDATE \`Lead\`
         SET \`visitOutcome\` = NULL
         WHERE \`status\` = 'LOST'
           AND \`lostReason\` IN (${unqualifyingLabels.map(() => '?').join(',')})
           AND \`visitOutcome\` IS NOT NULL`,
        unqualifyingLabels,
      );
      if (visitClearBackfill?.affectedRows > 0) {
        console.log(`[migrate] Cleared visitOutcome for ${visitClearBackfill.affectedRows} unqualified-system-reason Lead(s)`);
      }
    }

    // Repair: if an earlier boot created StudentEnrollment with MySQL 8's
    // default `utf8mb4_0900_ai_ci` collation, convert it to match Student
    // so cross-table joins work. CONVERT TO is a no-op when the collation
    // already matches, so this is safe to run every boot.
    try {
      await conn.execute(
        `ALTER TABLE \`StudentEnrollment\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } catch (e: any) {
      // ER_NO_SUCH_TABLE shouldn't fire (we just created it), but guard
      // anyway so a deploy that skips the create phase doesn't break.
      if (e?.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // Backfill: every existing Student needs at least one StudentEnrollment
    // row covering their full active period. Skip students that already
    // have one (idempotent — safe to run on every boot).
    const [enrollmentBackfill] = await conn.execute<any>(
      `INSERT INTO \`StudentEnrollment\`
        (\`id\`, \`studentId\`, \`packageId\`, \`monthlyFee\`, \`feeOverridden\`,
         \`startDate\`, \`endDate\`, \`reason\`, \`createdAt\`)
       SELECT
         UUID(),
         s.\`id\`,
         s.\`packageId\`,
         COALESCE(s.\`monthlyFee\`, 0),
         s.\`feeOverridden\`,
         COALESCE(s.\`startDate\`, s.\`enrolledAt\`),
         s.\`withdrawnAt\`,
         NULL,
         s.\`createdAt\`
       FROM \`Student\` s
       WHERE NOT EXISTS (
         SELECT 1 FROM \`StudentEnrollment\` e WHERE e.\`studentId\` = s.\`id\`
       )`,
    );
    if (enrollmentBackfill?.affectedRows > 0) {
      console.log(`[migrate] Backfilled ${enrollmentBackfill.affectedRows} StudentEnrollment row(s) from existing Student(s)`);
    }

    // Reconcile Student.startDate / enrolmentYear / enrolmentMonth with the
    // earliest StudentEnrollment row. The enrolment timeline is the single
    // source of truth for "when does this student actually start"; the
    // Student-row columns are a denormalized cache that legacy readers
    // (and the year dropdown filter) still depend on. Idempotent — only
    // rows that are out of sync get touched.
    const [studentDateSync] = await conn.execute<any>(
      `UPDATE \`Student\` s
       JOIN (
         SELECT \`studentId\`, MIN(\`startDate\`) AS earliest
         FROM \`StudentEnrollment\`
         GROUP BY \`studentId\`
       ) e ON e.\`studentId\` = s.\`id\`
       SET
         s.\`startDate\`      = e.earliest,
         s.\`enrolmentYear\`  = YEAR(e.earliest),
         s.\`enrolmentMonth\` = MONTH(e.earliest)
       WHERE s.\`startDate\` IS NULL
          OR s.\`startDate\`      <> e.earliest
          OR s.\`enrolmentYear\`  <> YEAR(e.earliest)
          OR s.\`enrolmentMonth\` <> MONTH(e.earliest)`,
    );
    if (studentDateSync?.affectedRows > 0) {
      console.log(`[migrate] Synced startDate/enrolmentYear/enrolmentMonth on ${studentDateSync.affectedRows} Student row(s) to match earliest enrolment`);
    }

    // Backfill Lead.statusChangedAt for ENROLLED leads using their
    // matching Student.enrolledAt (the "payment date" the admin entered).
    // createStudent used to flip the status without setting statusChangedAt,
    // so legacy enrolled leads have NULL there. Sales Analysis buckets by
    // statusChangedAt; without this, all old enrolments appear in their
    // enquiry month instead of their payment month. Idempotent.
    const [paymentDateSync] = await conn.execute<any>(
      `UPDATE \`Lead\` l
       JOIN \`Student\` s ON s.\`leadId\` = l.\`id\`
       SET l.\`statusChangedAt\` = s.\`enrolledAt\`
       WHERE l.\`status\` = 'ENROLLED'
         AND (l.\`statusChangedAt\` IS NULL OR l.\`statusChangedAt\` <> s.\`enrolledAt\`)`,
    );
    if (paymentDateSync?.affectedRows > 0) {
      console.log(`[migrate] Backfilled Lead.statusChangedAt from Student.enrolledAt on ${paymentDateSync.affectedRows} ENROLLED lead(s)`);
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

    // Phase 4a: seed default mission categories + loosen the legacy enum.
    // Categories are admin-managed now; the 5 originals are seeded so
    // existing missions continue to resolve. Idempotent — INSERT IGNORE
    // skips rows already present.
    try {
      await conn.execute(
        `ALTER TABLE \`CareerMission\` MODIFY \`category\` VARCHAR(50) NOT NULL`,
      );
    } catch (e: any) {
      // Column might not exist yet on a fresh DB (table just got created
      // with the new VARCHAR shape). Anything else, surface.
      if (e?.code !== 'ER_BAD_FIELD_ERROR' && e?.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[migrate] CareerMission.category MODIFY skipped:', e.message);
      }
    }
    type CategorySeed = { code: string; name: string; achievementName: string; icon: string; color: string; description: string };
    const DEFAULT_CATEGORIES: CategorySeed[] = [
      { code: 'CLASSROOM',  name: 'Classroom',  achievementName: 'Classroom Leader',           icon: 'faRoad',           color: '#1e40af', description: 'Demonstrated independent classroom routines and lesson delivery.' },
      { code: 'SOP',        name: 'SOP',        achievementName: 'SOP Reliable',               icon: 'faClipboardCheck', color: '#0e7490', description: 'Reliably follows school standard operating procedures.' },
      { code: 'EVENT',      name: 'Event',      achievementName: 'Event Leader',               icon: 'faCalendarDays',   color: '#9a3412', description: 'Plans and leads school events end-to-end.' },
      { code: 'PARENT',     name: 'Parent',     achievementName: 'Parent Communication Ready', icon: 'faPeopleArrows',   color: '#86198f', description: 'Owns parent relationships with confidence.' },
      { code: 'LEADERSHIP', name: 'Leadership', achievementName: 'Team Builder',               icon: 'faStar',           color: '#92400e', description: 'Mentors and develops other teachers.' },
    ];
    let seededCategoryCount = 0;
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const c = DEFAULT_CATEGORIES[i];
      const [res] = await conn.execute<any>(
        `INSERT IGNORE INTO \`MissionCategory\`
          (\`code\`, \`name\`, \`achievementName\`, \`description\`, \`icon\`, \`color\`, \`sortOrder\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [c.code, c.name, c.achievementName, c.description, c.icon, c.color, i],
      );
      if (res?.affectedRows > 0) seededCategoryCount++;
    }
    if (seededCategoryCount > 0) {
      console.log(`[migrate] Seeded ${seededCategoryCount} default MissionCategory row(s)`);
    }

    // Phase 4a-2: seed system-managed allowance types. The Compensation
    // page maps each per-teacher allowance row to a card by name and
    // uses the icon + isGuaranteed columns to drive the visual style.
    // Idempotent: lookup by name, only insert if missing.
    type AllowanceSeed = { name: string; icon: string; isGuaranteed: boolean; parentName?: string };
    const DEFAULT_ALLOWANCE_TYPES: AllowanceSeed[] = [
      { name: 'Attendance Allowance',          icon: 'calendar-check', isGuaranteed: false },
      { name: 'KPI Allowance',                 icon: 'gauge-high',     isGuaranteed: false },
      { name: 'Level Allowance',               icon: 'award',          isGuaranteed: true  },
      // Other Allowance is a category container; sub-types nest under
      // it via parentId. Listed before its children so the parent row
      // always exists when the child seed resolves the parent ID.
      { name: 'Other Allowance',               icon: 'gift',           isGuaranteed: true  },
      // Children of Other Allowance — these are system-managed (cannot
      // be deleted from the UI) but live under the Other category.
      { name: 'Qualification Allowance',       icon: 'graduation-cap', isGuaranteed: true,  parentName: 'Other Allowance' },
      { name: 'Training Completion Allowance', icon: 'book-open',      isGuaranteed: false, parentName: 'Other Allowance' },
    ];
    let seededAllowanceCount = 0;
    for (let i = 0; i < DEFAULT_ALLOWANCE_TYPES.length; i++) {
      const t = DEFAULT_ALLOWANCE_TYPES[i];
      // Resolve parentId (if this seed entry declares a parentName).
      let parentId: string | null = null;
      if (t.parentName) {
        const [parentRows] = await conn.execute<any>(
          'SELECT id FROM `AllowanceType` WHERE name = ? LIMIT 1',
          [t.parentName],
        );
        if (Array.isArray(parentRows) && parentRows.length > 0) {
          parentId = parentRows[0].id;
        }
      }
      const [existing] = await conn.execute<any>(
        'SELECT id FROM `AllowanceType` WHERE name = ? LIMIT 1',
        [t.name],
      );
      if (Array.isArray(existing) && existing.length === 0) {
        await conn.execute(
          'INSERT INTO `AllowanceType` (`id`, `name`, `isDefault`, `sortOrder`, `icon`, `isGuaranteed`, `parentId`, `createdAt`) VALUES (?, ?, 1, ?, ?, ?, ?, NOW(3))',
          [randomUUID(), t.name, i, t.icon, t.isGuaranteed ? 1 : 0, parentId],
        );
        seededAllowanceCount++;
      } else {
        // Existing row — refresh sortOrder + isDefault, and link
        // parentId if it's still null (avoids overwriting a manual
        // re-parent). icon/isGuaranteed only update if still at
        // column-default 'gift' (admin hasn't customized).
        await conn.execute(
          'UPDATE `AllowanceType` SET `isDefault` = 1, `sortOrder` = ?, `icon` = IF(`icon` = \'gift\' OR `icon` IS NULL, ?, `icon`), `isGuaranteed` = IF(`icon` = \'gift\' OR `icon` IS NULL, ?, `isGuaranteed`), `parentId` = COALESCE(`parentId`, ?) WHERE name = ?',
          [i, t.icon, t.isGuaranteed ? 1 : 0, parentId, t.name],
        );
      }
    }
    if (seededAllowanceCount > 0) {
      console.log(`[migrate] Seeded ${seededAllowanceCount} default AllowanceType row(s)`);
    }

    // Phase 4b: seed default career missions for each position. Idempotent:
    // we only seed a position if it has zero CareerMission rows (including
    // soft-deleted), so admin-deleted defaults won't reappear. The tier is
    // picked from the position name; positions whose name doesn't match a
    // known pattern get a generic intermediate set.
    type MissionSeed = {
      title: string;
      category: 'CLASSROOM' | 'SOP' | 'EVENT' | 'PARENT' | 'LEADERSHIP';
      difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';
      description: string;
      whyItMatters: string;
      evidenceRequirements: string;
      required: boolean;
      highPriority: boolean;
      requiresApproval: boolean;
    };
    const TIERS: Record<string, MissionSeed[]> = {
      entry: [
        { title: 'Master Classroom Routines',  category: 'CLASSROOM', difficulty: 'BASIC', required: true,  highPriority: true,  requiresApproval: true,
          description: 'Run daily classroom routines (arrival, transitions, departure) without supervisor prompting.',
          whyItMatters: 'Reliable routines are the foundation of every higher position. Without this, you can\'t take ownership of a class.',
          evidenceRequirements: 'Supervisor observation\nWeekly routine checklist\nVideo or photo of one transition' },
        { title: 'Complete SOP Onboarding',    category: 'SOP', difficulty: 'BASIC', required: true,  highPriority: true,  requiresApproval: true,
          description: 'Read and acknowledge all SOPs and pass the entry-level SOP quiz.',
          whyItMatters: 'Every promotion gate includes SOP compliance. Pass this once and the SOP track stays unblocked.',
          evidenceRequirements: 'Signed SOP acknowledgement\nSOP quiz score (≥80%)' },
        { title: 'Daily Reports to Parents',   category: 'PARENT', difficulty: 'BASIC', required: true,  highPriority: false, requiresApproval: false,
          description: 'Submit accurate daily reports for assigned students for 4 consecutive weeks.',
          whyItMatters: 'Consistent parent communication earns trust — it\'s the cheapest way to demonstrate you\'re ready for more responsibility.',
          evidenceRequirements: '4 weeks of submitted reports\nSpot-check by supervisor' },
        { title: 'Safety & Hygiene Checklist', category: 'SOP', difficulty: 'BASIC', required: true,  highPriority: false, requiresApproval: true,
          description: 'Pass the unannounced classroom safety & hygiene audit.',
          whyItMatters: 'Safety failures block all promotions. Demonstrating it once shows you can be trusted in a classroom alone.',
          evidenceRequirements: 'Audit pass certificate' },
        { title: 'Parent Greeting Protocol',   category: 'PARENT', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Greet every parent by name during pickup/drop-off for one full week.',
          whyItMatters: 'A small but visible signal that you\'re ready to own parent relationships.',
          evidenceRequirements: 'Supervisor observation' },
      ],
      junior: [
        { title: 'Lead a Lesson',                  category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: true,  requiresApproval: true,
          description: 'Plan and lead a full lesson independently with supervisor observation.',
          whyItMatters: 'Independent lesson delivery is the single biggest gap between Junior and Senior. Closing it makes the next promotion conversation easy.',
          evidenceRequirements: 'Lesson plan\nObservation feedback form\nStudent work samples' },
        { title: 'Manage Behaviour Independently', category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: true,  requiresApproval: true,
          description: 'Resolve a behaviour incident independently using the school behaviour framework.',
          whyItMatters: 'Senior teachers can\'t escalate every incident. Proving you can handle one signals readiness for class ownership.',
          evidenceRequirements: 'Incident report\nResolution outcome' },
        { title: 'Conduct Parent-Teacher Update',  category: 'PARENT', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead a one-on-one parent update meeting with prepared talking points.',
          whyItMatters: 'Direct parent dialogue is required at the next stage. Practice now while a supervisor is observing.',
          evidenceRequirements: 'Meeting notes\nParent feedback' },
        { title: 'Assist in a School Event',       category: 'EVENT', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: false,
          description: 'Take a named role in a school event (set-up, station lead, runner).',
          whyItMatters: 'Event support is how Senior teachers earn the right to lead one. Start small.',
          evidenceRequirements: 'Event role assignment\nPost-event reflection' },
        { title: 'Pass SOP Spot Check',            category: 'SOP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Pass two unannounced SOP spot checks within a quarter.',
          whyItMatters: 'SOP reliability is non-negotiable for class ownership. Two consecutive passes prove this isn\'t a fluke.',
          evidenceRequirements: 'Spot-check pass records (×2)' },
      ],
      senior: [
        { title: 'Run a Class Independently',     category: 'CLASSROOM', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Take full ownership of a class for one term — planning, execution, parent comms, reporting.',
          whyItMatters: 'Supervisors are evaluated on team output. Owning a class proves you can be evaluated on it instead of supervised through it.',
          evidenceRequirements: 'Term plan\nMidterm review\nEnd-of-term parent feedback' },
        { title: 'Lead a Parent Conference',      category: 'PARENT', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Run a structured parent conference covering progress, next-term goals, and concerns.',
          whyItMatters: 'Parent conferences are a Supervisor-level signal. Closing one cleanly is the cheapest way to demonstrate readiness.',
          evidenceRequirements: 'Conference agenda\nParent sign-off\nNotes' },
        { title: 'Co-Lead a School Event',        category: 'EVENT', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Co-own the planning + execution of a school event with another senior.',
          whyItMatters: 'Demonstrates you can plan and ship something bigger than your own class — a hard requirement at Supervisor level.',
          evidenceRequirements: 'Event plan\nBudget reconciliation\nPost-event report' },
        { title: 'Mentor a Junior Teacher',       category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: true,  requiresApproval: true,
          description: 'Mentor a junior teacher through their onboarding for at least one month.',
          whyItMatters: 'Supervisors\' main lever is uplifting the team. Mentorship is the proof you can do it.',
          evidenceRequirements: 'Mentee progress log\nWeekly 1:1 notes' },
        { title: 'Curriculum Contribution',       category: 'CLASSROOM', difficulty: 'ADVANCED', required: false, highPriority: false, requiresApproval: true,
          description: 'Propose and ship a curriculum improvement adopted by the school.',
          whyItMatters: 'Optional, but a strong signal of going beyond your current scope — pulls a future Shadow Principal review.',
          evidenceRequirements: 'Proposal doc\nAdoption decision' },
      ],
      supervisor: [
        { title: 'Manage Class Schedule',          category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Build and maintain the weekly class schedule across teachers and rooms.',
          whyItMatters: 'Operational ownership is core to the next stage. Schedule conflicts that you resolved are the easiest evidence to produce.',
          evidenceRequirements: 'Approved weekly schedule\nConflict resolution notes' },
        { title: 'Conduct Team Briefings',         category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: true,  requiresApproval: true,
          description: 'Lead the daily/weekly team briefing for one full month.',
          whyItMatters: 'Setting team rhythm is what Shadow Principals do daily. Practicing this with a smaller team builds the muscle.',
          evidenceRequirements: 'Briefing agenda samples\nAttendance log' },
        { title: 'Resolve Parent Escalation',      category: 'PARENT', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Own a parent escalation end-to-end — diagnosis, resolution, follow-up.',
          whyItMatters: 'Principals own outcomes when teachers can\'t close a parent issue. Show you\'re the one those issues stop with.',
          evidenceRequirements: 'Escalation case file\nResolution sign-off' },
        { title: 'Lead a School Event',            category: 'EVENT', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Be the lead organiser for a major school event.',
          whyItMatters: 'Solo event leadership demonstrates readiness for cross-team accountability — the threshold for Shadow Principal.',
          evidenceRequirements: 'Event plan\nPost-event report\nParent feedback summary' },
        { title: 'SOP Audit Lead',                 category: 'SOP', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead a quarterly SOP audit across at least three classrooms.',
          whyItMatters: 'Auditing is a leadership skill. Doing one well surfaces what your future self will need to fix.',
          evidenceRequirements: 'Audit checklist used\nFindings + remediation plan' },
        { title: 'Train a New Teacher',            category: 'LEADERSHIP', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Take a new hire from day-1 to fully independent within one month.',
          whyItMatters: 'Hiring impact compounds. Showing you can ramp someone up is what makes a Shadow Principal worth promoting.',
          evidenceRequirements: 'Training plan\nNew hire sign-off' },
      ],
      shadow: [
        { title: 'Run Weekly Operations',          category: 'LEADERSHIP', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Operate the school for one full week as acting principal.',
          whyItMatters: 'The strongest possible signal that you\'re ready for the principal seat.',
          evidenceRequirements: 'Operations log\nIssue resolution log\nPrincipal sign-off' },
        { title: 'Lead a Hiring Round',            category: 'LEADERSHIP', difficulty: 'ADVANCED', required: true, highPriority: true,  requiresApproval: true,
          description: 'Own a complete hiring round — JD, sourcing, interviews, offer.',
          whyItMatters: 'Principals own the team they inherit. Building yours starts here.',
          evidenceRequirements: 'Hiring scorecard\nFinal hire decision memo' },
        { title: 'Drive a Strategic Initiative',   category: 'LEADERSHIP', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Take a strategic initiative from proposal to full rollout.',
          whyItMatters: 'Demonstrates you can move the school forward, not just run it day-to-day.',
          evidenceRequirements: 'Initiative proposal\nKPIs achieved' },
        { title: 'Parent Community Building',      category: 'PARENT', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Build or grow a parent community programme (e.g. PTA, parent committee).',
          whyItMatters: 'Long-term parent retention is a Principal-level outcome. Lay the foundation now.',
          evidenceRequirements: 'Programme charter\nParticipation metrics' },
        { title: 'Quality Audit Across Classes',   category: 'SOP', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead a school-wide quality audit and present findings to leadership.',
          whyItMatters: 'Top-down accountability is the principal\'s job. Practice it once before you own it.',
          evidenceRequirements: 'Audit report\nPresentation deck' },
      ],
      generic: [
        { title: 'Capability Mission 1',  category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: true,  requiresApproval: true,
          description: 'Edit me — describe what success looks like at this position level.',
          whyItMatters: 'Edit me — explain why completing this is what unlocks the next position.',
          evidenceRequirements: 'Edit me' },
        { title: 'Capability Mission 2',  category: 'SOP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Edit me.',
          whyItMatters: 'Edit me.',
          evidenceRequirements: 'Edit me' },
        { title: 'Capability Mission 3',  category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Edit me.',
          whyItMatters: 'Edit me.',
          evidenceRequirements: 'Edit me' },
      ],
    };

    // Phase 4b-extra: top-up missions per tier. Inserted with deterministic
    // IDs (`mx-${positionId}-${n}`) so this phase is idempotent and admin
    // deletions stay sticky (INSERT IGNORE skips when the row already exists,
    // even soft-deleted). Adding more missions to TIER_EXTRAS later will
    // automatically seed them on the next boot.
    const TIER_EXTRAS: Record<string, MissionSeed[]> = {
      entry: [
        { title: 'Document Daily Activities',  category: 'CLASSROOM', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: false,
          description: 'Maintain a daily classroom activity log for one full month.',
          whyItMatters: 'Documentation discipline carries forward — it\'s what makes parent updates and senior reviews fast later on.',
          evidenceRequirements: '4 weeks of daily logs\nSupervisor sign-off' },
        { title: 'First-Aid Awareness',        category: 'SOP', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: true,
          description: 'Complete the first-aid orientation and pass the basic emergency response check.',
          whyItMatters: 'Children\'s safety is the school\'s number-one obligation. Knowing what to do in the first 60 seconds is non-negotiable.',
          evidenceRequirements: 'First-aid orientation certificate\nEmergency drill participation' },
        { title: 'Observe a Senior Teacher',   category: 'CLASSROOM', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Shadow a senior teacher for one full day and capture three takeaways.',
          whyItMatters: 'Watching how someone runs the room cuts months off your own learning curve.',
          evidenceRequirements: 'Observation notes\nThree takeaways shared with supervisor' },
        { title: 'Build a Classroom Resource', category: 'CLASSROOM', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Create a reusable classroom resource (visual aid, activity sheet, or song pack).',
          whyItMatters: 'Small contributions early signal that you take ownership beyond your assigned tasks.',
          evidenceRequirements: 'Resource shared in team folder' },
        { title: 'Greet Parents at Drop-Off',  category: 'PARENT', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Lead morning drop-off greetings for one full week.',
          whyItMatters: 'Parents read the front door — being visible there builds trust before you say a word.',
          evidenceRequirements: 'Supervisor observation\nParent feedback (informal)' },
      ],
      junior: [
        { title: 'Run a Small-Group Activity',     category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Plan and run a structured small-group learning activity.',
          whyItMatters: 'Differentiated group work is where Junior teachers prove they can handle attention split across students.',
          evidenceRequirements: 'Activity plan\nSupervisor observation\nStudent output samples' },
        { title: 'Document Behaviour Patterns',    category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: false,
          description: 'Track and document behaviour patterns for two students over two weeks.',
          whyItMatters: 'Pattern-spotting is the precursor to intervention. Senior teachers are expected to do this without prompting.',
          evidenceRequirements: 'Behaviour log\nPattern summary\nSupervisor review' },
        { title: 'Lead a Story Session',           category: 'CLASSROOM', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Lead a full circle-time story session with engagement activities.',
          whyItMatters: 'Story-time leadership is low-risk practice for whole-class delivery.',
          evidenceRequirements: 'Session plan\nPeer or supervisor observation' },
        { title: 'Co-design a Lesson Plan',        category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: false, highPriority: false, requiresApproval: true,
          description: 'Co-design a lesson plan with a senior teacher and deliver it together.',
          whyItMatters: 'Co-design is faster than going solo and exposes you to a senior\'s thought process.',
          evidenceRequirements: 'Joint lesson plan\nDelivery notes' },
        { title: 'Contribute to Parent Newsletter', category: 'PARENT', difficulty: 'BASIC', required: false, highPriority: false, requiresApproval: false,
          description: 'Write a published section in the monthly parent newsletter.',
          whyItMatters: 'Public-facing writing forces clarity — and gets your name in front of parents.',
          evidenceRequirements: 'Published newsletter section' },
        // — Required mission top-up (index 5 onward). Lifts the
        // junior tier above 4 required missions so the Mission Board
        // pagination (pageSize: 4) actually shows multiple pages.
        { title: 'Run a Parent Conference',         category: 'PARENT', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead a one-on-one parent conference covering a student\'s progress and next steps.',
          whyItMatters: 'Parent conferences expose every gap in your observation + communication craft. Doing one well is the strongest single signal of senior readiness.',
          evidenceRequirements: 'Pre-meeting prep notes\nConference summary\nParent feedback' },
        { title: 'Lead a Themed Week',              category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Plan and run a full themed week across all daily lessons and activities.',
          whyItMatters: 'A themed week stretches you from single-lesson delivery to a coherent narrative across five days — the building block of senior planning.',
          evidenceRequirements: 'Theme plan\nDaily activity log\nReflection on what worked' },
        { title: 'Maintain Daily Class Routine',    category: 'SOP', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: false,
          description: 'Run the full daily class routine (arrival, transitions, dismissal) without supervisor prompts for two weeks.',
          whyItMatters: 'Routine discipline is invisible when it works and obvious when it breaks. Owning it lifts the whole class\'s baseline.',
          evidenceRequirements: 'Routine checklist\nSupervisor observation' },
        { title: 'Run a Safety Drill',              category: 'SOP', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead a fire / lockdown / emergency drill for your class.',
          whyItMatters: 'Calm leadership under simulated stress is the rehearsal for the real moment. Junior teachers earn trust by owning these drills.',
          evidenceRequirements: 'Drill plan\nIncident-style debrief\nSupervisor sign-off' },
        { title: 'Submit a Class Reflection',       category: 'CLASSROOM', difficulty: 'BASIC', required: true, highPriority: false, requiresApproval: false,
          description: 'Write a monthly class reflection covering wins, struggles, and one change you\'ll try next month.',
          whyItMatters: 'Reflection turns experience into skill. Senior teachers do this instinctively; juniors build the habit.',
          evidenceRequirements: 'Monthly reflection document\nSupervisor 1:1 discussion' },
      ],
      senior: [
        { title: 'Lead a Field Trip',                  category: 'EVENT', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Be the lead organiser for an off-campus field trip — logistics, safety plan, parent comms.',
          whyItMatters: 'Off-site responsibility is a step up in trust. Doing one cleanly is hard evidence of operational maturity.',
          evidenceRequirements: 'Trip plan\nRisk assessment\nPost-trip debrief' },
        { title: 'Manage Class Substitution',          category: 'CLASSROOM', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: false,
          description: 'Cover another teacher\'s class for one full week without disruption to learning.',
          whyItMatters: 'Substitution requires holding the room with no ramp-up time — a real test of preparedness.',
          evidenceRequirements: 'Sub plan\nDaily handover notes\nSupervisor sign-off' },
        { title: 'Conduct a Peer Skill Workshop',      category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Design and run a 30-minute skill workshop for the teaching team.',
          whyItMatters: 'Teaching adults is a leadership skill. A workshop is the smallest version of leading the team.',
          evidenceRequirements: 'Workshop deck\nAttendance + feedback' },
        { title: 'Author a Best-Practice Guide',       category: 'SOP', difficulty: 'INTERMEDIATE', required: false, highPriority: false, requiresApproval: true,
          description: 'Write a one-page best-practice guide adopted by the team.',
          whyItMatters: 'Codifying knowledge moves you from "operator" to "system builder".',
          evidenceRequirements: 'Published guide\nAdoption sign-off' },
        { title: 'Coach a Difficult Behaviour Case',   category: 'CLASSROOM', difficulty: 'ADVANCED', required: false, highPriority: false, requiresApproval: true,
          description: 'Lead a behaviour intervention plan for a complex case with measurable progress.',
          whyItMatters: 'Hard behaviour cases are what separate good teachers from leaders. Closing one is the strongest possible signal.',
          evidenceRequirements: 'Intervention plan\nProgress metrics\nSupervisor review' },
      ],
      supervisor: [
        { title: 'Run Recruitment Screening',     category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: true, highPriority: false, requiresApproval: true,
          description: 'Screen and shortlist candidates for an open teaching role.',
          whyItMatters: 'Hiring is the highest-leverage activity in a school. Getting reps as a screener prepares you to own the call later.',
          evidenceRequirements: 'Screening rubric\nShortlist memo' },
        { title: 'Plan Term Curriculum',          category: 'CLASSROOM', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Design the curriculum arc for one full term across multiple classes.',
          whyItMatters: 'Cross-class planning is what unlocks Shadow Principal — it\'s the first time you optimise across, not within, a class.',
          evidenceRequirements: 'Curriculum plan\nClass-team review notes' },
        { title: 'Coach Two Mentees Concurrently', category: 'LEADERSHIP', difficulty: 'ADVANCED', required: false, highPriority: false, requiresApproval: true,
          description: 'Mentor two junior teachers in parallel for one term.',
          whyItMatters: 'Parallel mentorship tests your ability to scale your influence — exactly what the next stage demands.',
          evidenceRequirements: 'Mentee plans\nWeekly 1:1 logs\nMentee outcomes' },
        { title: 'Build a Department KPI Report', category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: false, highPriority: false, requiresApproval: true,
          description: 'Define department KPIs and produce a quarterly report.',
          whyItMatters: 'What gets measured gets managed. Defining the measures is half the leadership.',
          evidenceRequirements: 'KPI definition doc\nQ-end report' },
      ],
      shadow: [
        { title: 'Cover Principal Absence',         category: 'LEADERSHIP', difficulty: 'ADVANCED', required: true, highPriority: true, requiresApproval: true,
          description: 'Be the named cover when the principal is away (planned absence ≥ 3 days).',
          whyItMatters: 'Cover is the rehearsal for the actual seat. Closing one cleanly is the strongest possible promotion signal.',
          evidenceRequirements: 'Cover handover doc\nIssue resolution log\nPrincipal sign-off' },
        { title: 'Lead a Crisis Response',          category: 'SOP', difficulty: 'ADVANCED', required: true, highPriority: false, requiresApproval: true,
          description: 'Lead the response to a real or simulated crisis (safety, parent, operational).',
          whyItMatters: 'Crisis leadership is what parents remember. Doing one well is what makes principal succession credible.',
          evidenceRequirements: 'Incident timeline\nResponse decisions\nPost-incident review' },
        { title: 'Build the Annual Calendar',       category: 'EVENT', difficulty: 'ADVANCED', required: false, highPriority: false, requiresApproval: true,
          description: 'Design the school\'s full annual event + academic calendar.',
          whyItMatters: 'Annual planning is a Principal-level deliverable. Ship one to remove ambiguity about your readiness.',
          evidenceRequirements: 'Annual calendar published\nLeadership sign-off' },
        { title: 'Run a Parent Town Hall',          category: 'PARENT', difficulty: 'ADVANCED', required: false, highPriority: false, requiresApproval: true,
          description: 'Host a parent town hall covering school direction, Q&A, and feedback collection.',
          whyItMatters: 'Town halls are the principal\'s most public moment. Practicing once removes the fear when it matters.',
          evidenceRequirements: 'Town hall agenda\nQ&A summary\nFollow-up actions' },
        { title: 'Negotiate a Vendor Contract',     category: 'LEADERSHIP', difficulty: 'INTERMEDIATE', required: false, highPriority: false, requiresApproval: true,
          description: 'Negotiate or renew a vendor contract for the school.',
          whyItMatters: 'Commercial confidence rounds out the operator. Principals own these calls — get reps now.',
          evidenceRequirements: 'Negotiated terms\nFinance sign-off' },
      ],
      generic: [],
    };
    function pickTier(positionName: string): keyof typeof TIERS | null {
      const n = positionName.toLowerCase();
      // Final stage — no missions seeded.
      if (/principal/.test(n) && !/shadow/.test(n)) return null;
      if (/shadow\s*principal/.test(n)) return 'shadow';
      if (/supervisor/.test(n)) return 'supervisor';
      if (/senior/.test(n)) return 'senior';
      if (/junior|staff/.test(n)) return 'junior';
      if (/assistant|trainee|intern/.test(n)) return 'entry';
      return 'generic';
    }
    const [allPositionRows] = await conn.execute<any[]>(
      `SELECT positionId, name FROM \`Position\``,
    );
    let seededMissionCount = 0;
    for (const p of allPositionRows) {
      // Count includes soft-deleted rows so admin deletions are sticky.
      const [[{ cnt: existing }]] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM \`CareerMission\` WHERE positionId = ?`,
        [p.positionId],
      ) as any;
      if (Number(existing) > 0) continue;
      const tierKey = pickTier(p.name);
      if (!tierKey) continue;
      const tier = TIERS[tierKey];
      for (let i = 0; i < tier.length; i++) {
        const m = tier[i];
        const id = randomUUID();
        await conn.execute(
          `INSERT INTO \`CareerMission\`
            (id, positionId, title, category, description, whyItMatters, difficulty, evidenceRequirements,
             required, highPriority, requiresApproval, displayOrder, deletedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(3), NOW(3))`,
          [id, p.positionId, m.title, m.category, m.description, m.whyItMatters, m.difficulty, m.evidenceRequirements,
           m.required ? 1 : 0, m.highPriority ? 1 : 0, m.requiresApproval ? 1 : 0, i],
        );
        seededMissionCount++;
      }
    }
    if (seededMissionCount > 0) {
      console.log(`[migrate] Seeded ${seededMissionCount} default CareerMission(s) across ${allPositionRows.length} position(s)`);
    }

    // Top-up: insert TIER_EXTRAS missions with deterministic IDs. INSERT
    // IGNORE means re-runs are no-ops, and admin deletions stay sticky
    // because the soft-deleted row keeps the PK occupied.
    let topUpCount = 0;
    for (const p of allPositionRows) {
      const tierKey = pickTier(p.name);
      if (!tierKey) continue;
      const extras = TIER_EXTRAS[tierKey];
      if (!extras || extras.length === 0) continue;
      const baseOrder = TIERS[tierKey].length;
      for (let i = 0; i < extras.length; i++) {
        const m = extras[i];
        const id = `mx-${p.positionId}-${i}`;
        const [res] = await conn.execute<any>(
          `INSERT IGNORE INTO \`CareerMission\`
            (id, positionId, title, category, description, whyItMatters, difficulty, evidenceRequirements,
             required, highPriority, requiresApproval, displayOrder, deletedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(3), NOW(3))`,
          [id, p.positionId, m.title, m.category, m.description, m.whyItMatters, m.difficulty, m.evidenceRequirements,
           m.required ? 1 : 0, m.highPriority ? 1 : 0, m.requiresApproval ? 1 : 0, baseOrder + i],
        );
        if (res?.affectedRows > 0) topUpCount++;
      }
    }
    if (topUpCount > 0) {
      console.log(`[migrate] Topped up ${topUpCount} extra CareerMission(s) across positions`);
    }

    // Phase 4c: seed Position roleFocus + description from the org-
    // chart job scope, written as the abilities a teacher unlocks at
    // each rank — first-person framing ("Set the school's strategic
    // direction…") so the description reads naturally regardless of
    // whether the rank is locked or earned. No UI prelude needed.
    //
    // The seed only fills rows where the column IS NULL so admin
    // edits are never overwritten. We ALSO unconditionally upgrade
    // legacy seed copy (matched by exact text) to the new wording so
    // users don't get stuck on the old, less-evocative descriptions.
    const POSITION_DESCRIPTIONS: { match: string[]; roleFocus: string; description: string; legacyDescriptions?: string[] }[] = [
      {
        match: ['principal'],
        roleFocus: 'Overall School Management',
        description: 'Set the school\'s strategic direction, define the policies that shape day-to-day practice, and keep every operation aligned with the school\'s vision and goals.',
        legacyDescriptions: [
          'Oversee all school operations, make strategic decisions, set policies, and ensure alignment with the school\'s vision and goals.',
        ],
      },
      {
        match: ['shadow principal'],
        roleFocus: 'School Management Support',
        description: 'Stand in for the Principal on significant decisions, consult on major strategic moves, and drive the implementation of school-wide policies.',
        legacyDescriptions: [
          'Assist the Principal, handle significant decisions, consult the principal for major strategic issues, and support policy implementation.',
        ],
      },
      {
        match: ['supervisor'],
        roleFocus: 'Daily Operations Oversight',
        description: 'Run daily school operations end to end, make calls on operational issues and staff management, and keep the Principal or Shadow Principal informed of anything significant.',
        legacyDescriptions: [
          'Manage daily school operations, make decisions on operational issues and staff management, and inform the Principal or Shadow Principal about significant actions.',
        ],
      },
      {
        match: ['senior teacher', 'senior ei'],
        roleFocus: 'Instructional Leadership',
        description: 'Set the bar for instructional practice, lead lesson planning and curriculum decisions, and keep your classroom aligned with school standards.',
        legacyDescriptions: [
          'Lead instructional practices, make decisions on lesson planning and curriculum, and ensure alignment with school standards.',
        ],
      },
      {
        match: ['junior teacher', 'junior ei'],
        roleFocus: 'Classroom Instruction',
        description: 'Own daily classroom instruction, escalate significant decisions to your Supervisor or Principal, and confidently put approved teaching strategies into practice.',
        legacyDescriptions: [
          'Handle classroom instruction, seek approval from Supervisor or Principal for significant decisions, and implement approved strategies.',
        ],
      },
      {
        match: ['assistant teacher', 'assistant ei'],
        roleFocus: 'Classroom Support',
        description: 'Support daily classroom activities, partner with the Junior Teacher to keep the room running, and seek approval before changing classroom operations.',
        legacyDescriptions: [
          'Support classroom activities, follow authority structure of Junior Teacher, and require approval for actions affecting classroom operations.',
        ],
      },
    ];
    let posFieldSeeded = 0;
    let posDescUpgraded = 0;
    for (const entry of POSITION_DESCRIPTIONS) {
      const placeholders = entry.match.map(() => '?').join(', ');
      // roleFocus — only fill when empty.
      const [rfRes] = await conn.execute<any>(
        `UPDATE \`Position\`
           SET roleFocus = ?
         WHERE roleFocus IS NULL
           AND LOWER(name) IN (${placeholders})`,
        [entry.roleFocus, ...entry.match],
      );
      if (rfRes?.affectedRows > 0) posFieldSeeded += rfRes.affectedRows;
      // description — only fill when empty.
      const [dRes] = await conn.execute<any>(
        `UPDATE \`Position\`
           SET description = ?
         WHERE description IS NULL
           AND LOWER(name) IN (${placeholders})`,
        [entry.description, ...entry.match],
      );
      if (dRes?.affectedRows > 0) posFieldSeeded += dRes.affectedRows;
      // Upgrade legacy seed copy → ability-flavoured wording. Only
      // touches rows whose description exactly matches a previous
      // seed string, so any admin-edited row is left alone.
      if (entry.legacyDescriptions && entry.legacyDescriptions.length > 0) {
        const legacyPlaceholders = entry.legacyDescriptions.map(() => '?').join(', ');
        const [upRes] = await conn.execute<any>(
          `UPDATE \`Position\`
             SET description = ?
           WHERE LOWER(name) IN (${placeholders})
             AND description IN (${legacyPlaceholders})`,
          [entry.description, ...entry.match, ...entry.legacyDescriptions],
        );
        if (upRes?.affectedRows > 0) posDescUpgraded += upRes.affectedRows;
      }
    }
    if (posDescUpgraded > 0) {
      console.log(`[migrate] Upgraded ${posDescUpgraded} Position description(s) to ability-style wording`);
    }
    // Earlier auto-migrate (pre-split) put the headline inside
    // description with a "\n" separator. Migrate those to the new
    // roleFocus column so the form shows them in the right field.
    try {
      const [splitRes] = await conn.execute<any>(
        `UPDATE \`Position\`
           SET roleFocus  = SUBSTRING_INDEX(description, '\\n', 1),
               description = TRIM(SUBSTRING(description, LENGTH(SUBSTRING_INDEX(description, '\\n', 1)) + 2))
         WHERE roleFocus IS NULL
           AND description IS NOT NULL
           AND description LIKE '%\\n%'`,
      );
      if (splitRes?.affectedRows > 0) {
        console.log(`[migrate] Split legacy combined description into roleFocus on ${splitRes.affectedRows} Position row(s)`);
      }
    } catch (e: any) {
      console.warn('[migrate] Position description split skipped:', e.message);
    }
    if (posFieldSeeded > 0) {
      console.log(`[migrate] Seeded roleFocus / description on ${posFieldSeeded} Position field(s)`);
    }

    // Phase 5: reconcile pre-existing lost-reason strings with the current
    // system-pinned labels. Each mapping rewrites historical strings — on any
    // fresh deployment the UPDATE is a no-op.
    const LOST_REASON_RENAMES: [from: string, to: string][] = [
      ["Didn't reply",                              'No response or declined appointment'],
      ["Didn't reply or didn't want appointment",   'No response or declined appointment'],
      ["Didn't attend the enquiry",                 'Missed appointment'],
      ["Didn't attend",                             'Missed appointment'],
      ['No show',                                   'Missed appointment'],
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

    // Strip any obsolete/renamed entries and current system labels from the
    // settings lost_reasons list. `getSettings` always re-prepends system
    // labels on read, so the stored form only needs the user-managed tail.
    const obsoleteLabels = new Set<string>([
      "Didn't reply",
      "Didn't reply or didn't want appointment",
      "Didn't attend the enquiry",
      "Didn't attend",
      'No show',
      // Current system labels — drop from the user section so they don't
      // duplicate with the auto-prepended system block.
      ...SYSTEM_LOST_REASONS.map(r => r.label),
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

// Public-form candidate intake + resume upload. Both routes are unauth so
// they must be rate-limited; the form-options GET is read-only and cheap so
// we skip it. Body parsing for /resume happens via multer (multipart) so
// the global express.json() doesn't touch it.
const candidatePublicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { message: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/candidates', (req, _res, next) => {
  if (req.headers.authorization) return next();           // admin: skip
  if (req.method === 'GET' && req.path === '/form-options') return next();
  if (req.method === 'POST') return candidatePublicLimiter(req, _res, next);
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

// ── Static: uploaded files (badge images, etc.) ──
// Override helmet's default `same-origin` CORP so the SPA on a different
// origin (e.g. localhost:5173) can load these images via <img>.
import { UPLOAD_ROOT } from './routes/upload.routes.js';
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(UPLOAD_ROOT, { maxAge: '7d', fallthrough: false }),
);

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
