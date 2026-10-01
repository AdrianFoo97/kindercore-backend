-- Points & Rewards feature.
-- Points are always granted manually by a supervisor (no auto-earn).
-- Earning rules are an admin-curated reference / grant-template list;
-- the reward catalog + redemptions drive the spend side.
-- Run once on the target database.

CREATE TABLE IF NOT EXISTS `PointsEarningRule` (
  `id` VARCHAR(36) NOT NULL,
  `icon` VARCHAR(40) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `amount` INT NOT NULL,
  `category` VARCHAR(20) NOT NULL DEFAULT 'other',
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PointsRewardItem` (
  `id` VARCHAR(36) NOT NULL,
  `icon` VARCHAR(40) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `sub` VARCHAR(191) NULL,
  `cost` INT NOT NULL,
  `stock` ENUM('in','limited','out') NOT NULL DEFAULT 'in',
  `category` VARCHAR(20) NOT NULL DEFAULT 'other',
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PointsTransaction` (
  `id` VARCHAR(36) NOT NULL,
  `teacherId` VARCHAR(36) NOT NULL,
  `kind` ENUM('earned','redeemed') NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `delta` INT NOT NULL,
  `balanceAfter` INT NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `ruleId` VARCHAR(36) NULL,
  `redemptionId` VARCHAR(36) NULL,
  `note` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pt_teacher` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTE: status enum corrected to match src/db/schema.ts / points.controller.ts
-- (which only ever writes 'redeemed'|'pending'|'delivered') — the reference
-- copy of this migration on the `teacher-view` branch has a stale 5-state
-- enum that doesn't even include 'redeemed', the value every redemption is
-- actually created with. Do not widen this back to the stale version.
CREATE TABLE IF NOT EXISTS `RewardRedemption` (
  `id` VARCHAR(36) NOT NULL,
  `teacherId` VARCHAR(36) NOT NULL,
  `rewardId` VARCHAR(36) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `icon` VARCHAR(40) NOT NULL,
  `pointsSpent` INT NOT NULL,
  `status` ENUM('redeemed','pending','delivered') NOT NULL DEFAULT 'redeemed',
  `voucherCode` VARCHAR(60) NULL,
  `redemptionCode` VARCHAR(40) NOT NULL,
  `instructions` TEXT NULL,
  `redeemedDate` VARCHAR(10) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rr_teacher` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `TeacherRewardGoal` (
  `teacherId` VARCHAR(36) NOT NULL,
  `rewardId` VARCHAR(36) NOT NULL,
  `setAt` VARCHAR(10) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `Teacher` ADD COLUMN `pointsLastSeenAt` DATETIME(3) NULL;
