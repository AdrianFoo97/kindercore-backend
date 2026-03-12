CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `childName` VARCHAR(191) NOT NULL,
    `parentPhone` VARCHAR(191) NOT NULL,
    `childDob` DATETIME(3) NOT NULL,
    `enrolmentYear` INTEGER NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST') NOT NULL DEFAULT 'NEW',
    `notes` TEXT NULL,
    `appointmentStart` DATETIME(3) NULL,
    `appointmentEnd` DATETIME(3) NULL,
    `googleEventId` VARCHAR(191) NULL,
    `googleEventLink` TEXT NULL,
    `appointmentCreatedByUserId` VARCHAR(191) NULL,
    `appointmentIsPlaceholder` BOOLEAN NOT NULL DEFAULT false,
    `lostReason` TEXT NULL,
    `relationship` VARCHAR(191) NULL,
    `programme` VARCHAR(191) NULL,
    `preferredAppointmentTime` VARCHAR(191) NULL,
    `addressLocation` VARCHAR(191) NULL,
    `needsTransport` BOOLEAN NULL,
    `howDidYouKnow` VARCHAR(191) NULL,
    INDEX `Lead_submittedAt_idx`(`submittedAt`),
    INDEX `Lead_parentPhone_idx`(`parentPhone`),
    INDEX `Lead_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `SystemSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SystemSetting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `Student` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `enrolmentYear` INTEGER NOT NULL,
    `enrolmentMonth` INTEGER NOT NULL,
    `packageId` VARCHAR(191) NOT NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `onboardingProgress` JSON NULL,
    `onboardingCompleted` BOOLEAN NOT NULL DEFAULT false,
    `withdrawnAt` DATETIME(3) NULL,
    `withdrawReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Student_leadId_key`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Lead` ADD CONSTRAINT `Lead_appointmentCreatedByUserId_fkey` FOREIGN KEY (`appointmentCreatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Student` ADD CONSTRAINT `Student_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Student` ADD CONSTRAINT `Student_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `Package`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
