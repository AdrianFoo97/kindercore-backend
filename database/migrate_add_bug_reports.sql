-- Free-text bug reports — any signed-in user can submit one (currently
-- only exposed from the teacher mobile app's Settings page), an admin
-- triages them from Tools > Bug Reports.

CREATE TABLE IF NOT EXISTS `BugReport` (
  `id` VARCHAR(36) NOT NULL,
  `message` TEXT NOT NULL,
  `pageUrl` VARCHAR(500) NULL,
  `appVersion` VARCHAR(20) NULL,
  `reportedByUserId` VARCHAR(36) NOT NULL,
  `reportedByName` VARCHAR(191) NOT NULL,
  `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
