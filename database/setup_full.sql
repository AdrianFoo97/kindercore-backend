-- ══════════════════════════════════════════════════════════════════
-- KinderTech Full Database Setup (Production)
-- Drop all tables and recreate from scratch
-- ══════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `ScheduleBlock`, `SavedTimetable`, `Teacher`, `Classroom`, `Subject`, `PlannerTask`;
DROP TABLE IF EXISTS `Student`, `Package`, `Lead`, `GoogleConnection`, `SystemSetting`, `User`;
SET FOREIGN_KEY_CHECKS = 1;

-- ── User ─────────────────────────────────────────────────────────
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `inviteToken` VARCHAR(191) NULL,
    `inviteExpiresAt` DATETIME(3) NULL,
    `activated` TINYINT(1) NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Lead ─────────────────────────────────────────────────────────
CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `childName` VARCHAR(191) NOT NULL,
    `parentPhone` VARCHAR(191) NOT NULL,
    `childDob` DATETIME(3) NOT NULL,
    `enrolmentYear` INTEGER NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST', 'REJECTED') NOT NULL DEFAULT 'NEW',
    `notes` TEXT NULL,
    `appointmentStart` DATETIME(3) NULL,
    `appointmentEnd` DATETIME(3) NULL,
    `googleEventId` VARCHAR(191) NULL,
    `googleEventLink` TEXT NULL,
    `appointmentCreatedByUserId` VARCHAR(191) NULL,
    `appointmentIsPlaceholder` BOOLEAN NOT NULL DEFAULT false,
    `attended` TINYINT(1) NOT NULL DEFAULT 0,
    `lostReason` TEXT NULL,
    `relationship` VARCHAR(191) NULL,
    `programme` VARCHAR(191) NULL,
    `preferredAppointmentTime` VARCHAR(191) NULL,
    `addressLocation` VARCHAR(191) NULL,
    `needsTransport` BOOLEAN NULL,
    `howDidYouKnow` VARCHAR(191) NULL,
    `ctaSource` VARCHAR(50) NULL,
    `leadTemperature` ENUM('COOL', 'WARM', 'HOT') NULL,
    `deletedAt` DATETIME(3) NULL,
    `statusChangedAt` DATETIME(3) NULL,
    INDEX `Lead_submittedAt_idx`(`submittedAt`),
    INDEX `Lead_parentPhone_idx`(`parentPhone`),
    INDEX `Lead_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── GoogleConnection ─────────────────────────────────────────────
CREATE TABLE `GoogleConnection` (
    `id` VARCHAR(191) NOT NULL,
    `accessToken` TEXT NOT NULL,
    `refreshToken` TEXT NOT NULL,
    `expiryDate` BIGINT NOT NULL,
    `scope` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── SystemSetting ────────────────────────────────────────────────
CREATE TABLE `SystemSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SystemSetting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Package ──────────────────────────────────────────────────────
CREATE TABLE `Package` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `programme` VARCHAR(191) NOT NULL,
    `age` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` DOUBLE NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Package_year_programme_age_key`(`year`, `programme`, `age`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Student ──────────────────────────────────────────────────────
CREATE TABLE `Student` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `enrolmentYear` INTEGER NOT NULL,
    `enrolmentMonth` INTEGER NOT NULL,
    `packageId` VARCHAR(191) NOT NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `onboardingProgress` JSON NULL,
    `onboardingCompleted` BOOLEAN NOT NULL DEFAULT false,
    `withdrawnAt` DATETIME(3) NULL,
    `withdrawReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Student_leadId_key`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: Teacher ─────────────────────────────────────────────
CREATE TABLE `Teacher` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(7) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `allowedSubjectIds` JSON NULL,
    `allowedClassroomIds` JSON NULL,
    `workingHoursPerDay` FLOAT NULL DEFAULT 8,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: Classroom ───────────────────────────────────────────
CREATE TABLE `Classroom` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startMinute` INTEGER NULL,
    `endMinute` INTEGER NULL,
    `daysOfWeek` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: Subject ─────────────────────────────────────────────
CREATE TABLE `Subject` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(7) NOT NULL,
    `lessonsPerWeek` INTEGER NULL,
    `defaultDuration` INTEGER NULL DEFAULT 30,
    `classLessons` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: PlannerTask ─────────────────────────────────────────
CREATE TABLE `PlannerTask` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('TEACHING', 'ADMIN', 'DUTY', 'BREAK', 'OTHER') NOT NULL,
    `color` VARCHAR(7) NOT NULL,
    `defaultDuration` INTEGER NULL DEFAULT 30,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: ScheduleBlock ───────────────────────────────────────
CREATE TABLE `ScheduleBlock` (
    `id` VARCHAR(191) NOT NULL,
    `weekDate` DATETIME(3) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `durationMinutes` INTEGER NOT NULL DEFAULT 30,
    `teacherId` VARCHAR(191) NULL,
    `subjectId` VARCHAR(191) NULL,
    `taskId` VARCHAR(191) NULL,
    `classroomId` VARCHAR(191) NULL,
    `assignedTeacherIds` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ScheduleBlock_weekDate_idx`(`weekDate`),
    INDEX `ScheduleBlock_teacherId_idx`(`teacherId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Planner: SavedTimetable ──────────────────────────────────────
CREATE TABLE `SavedTimetable` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SavedTimetable_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Foreign Keys ─────────────────────────────────────────────────
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_appointmentCreatedByUserId_fkey` FOREIGN KEY (`appointmentCreatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Student` ADD CONSTRAINT `Student_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Student` ADD CONSTRAINT `Student_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `Package`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduleBlock` ADD CONSTRAINT `ScheduleBlock_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `Teacher`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduleBlock` ADD CONSTRAINT `ScheduleBlock_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ScheduleBlock` ADD CONSTRAINT `ScheduleBlock_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `PlannerTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ScheduleBlock` ADD CONSTRAINT `ScheduleBlock_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════════
-- Seed Data
-- ══════════════════════════════════════════════════════════════════

-- ── Users (Admin123! / Staff123!) ────────────────────────────────
INSERT INTO `User` (`id`, `email`, `name`, `passwordHash`, `role`, `activated`, `createdAt`, `updatedAt`) VALUES
  (UUID(), 'admin@kindercore.com', 'Admin', '$2b$10$jPFi23rVqSrf2MxTImBnzuejVYX2zr8ti8ke7GRtIOFfgchkKlLvG', 'SUPERADMIN', 1, NOW(), NOW()),
  (UUID(), 'staff@kinderCore.local', 'Staff', '$2b$10$AcjygauFsSurMWmPX//DsOGh/9nyI6w01tD6la/uj.zGsxMcue5x6', 'STAFF', 1, NOW(), NOW());

-- ── System Settings ──────────────────────────────────────────────
INSERT INTO `SystemSetting` (`id`, `key`, `value`, `description`, `updatedAt`) VALUES
  (UUID(), 'whatsapp_template', '"Hi, this is Ten Toes Preschool. Thanks for your enquiry for {{childName}}. Would you like to arrange a school visit?"', 'WhatsApp message template. Use {{childName}} as placeholder.', NOW()),
  (UUID(), 'appointment_duration_minutes', '30', 'Default appointment duration in minutes.', NOW()),
  (UUID(), 'appointment_lead_time_hours', '2', 'Hours ahead to schedule appointment from now.', NOW()),
  (UUID(), 'kinder_address', '"Bukit Indah, Johor Bahru"', 'Kindergarten address used in Google Calendar events.', NOW()),
  (UUID(), 'lost_reasons', '["Transportation","Operating Hours","Distance","Enrolled other school","Fee too expensive","Special Need","Class Full","Didn\'t reply","Under Age","Didn\'t attend the enquiry"]', 'Dropdown options for marking a lead as Lost.', NOW()),
  (UUID(), 'onboarding_tasks', '["Create parents group (format: Year_ClassName_ChildrenName)","Send welcome message (shortcut: newparentswelcome)","Send registration link (shortcut: newparentsregistration)","Enroll student to app (New enrollment => raw lead => enrolled)","Send Checklist for Completed Registration (shortcut: newparentsregdone)","Assign student to a class and add tag","Send App Invitation Link","Ask Parents to Set Up the Ten Toes App (shortcut: newparentsapp)","Send Checklist for Completed App Setup (shortcut: newparentsappdone)","Send invoice to new parents","Ask Parents to Join the Facebook Group (shortcut: newparentsfb)","Add Parents to the Facebook Group","Send Checklist for Completed Facebook Group Joining (shortcut: newparentsfbdone)","Order book, bag, uniform for new students","Send Reminder for Bag & Uniform Collection (shortcut: newparentsbag)","Send Checklist for Completed Bag & Uniform Collection"]', 'Checklist of tasks to complete when onboarding a new student.', NOW());

-- ── Packages ─────────────────────────────────────────────────────
INSERT INTO `Package` (`id`, `year`, `programme`, `age`, `name`, `price`, `updatedAt`) VALUES
  (UUID(), 2026, 'Half Day', 2, '2026 Half Day (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 3, '2026 Half Day (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 4, '2026 Half Day (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 5, '2026 Half Day (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 6, '2026 Half Day (6Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 2, '2026 Full Day (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 3, '2026 Full Day (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 4, '2026 Full Day (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 5, '2026 Full Day (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 6, '2026 Full Day (6Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 2, '2026 Half Day + Enrichment (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 3, '2026 Half Day + Enrichment (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 4, '2026 Half Day + Enrichment (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 5, '2026 Half Day + Enrichment (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 6, '2026 Half Day + Enrichment (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 2, '2027 Half Day (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 3, '2027 Half Day (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 4, '2027 Half Day (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 5, '2027 Half Day (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 6, '2027 Half Day (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 2, '2027 Full Day (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 3, '2027 Full Day (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 4, '2027 Full Day (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 5, '2027 Full Day (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 6, '2027 Full Day (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 2, '2027 Half Day + Enrichment (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 3, '2027 Half Day + Enrichment (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 4, '2027 Half Day + Enrichment (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 5, '2027 Half Day + Enrichment (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 6, '2027 Half Day + Enrichment (6Y)', NULL, NOW());
