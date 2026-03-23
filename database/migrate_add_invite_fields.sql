-- Add invite fields to User table for account setup flow
ALTER TABLE `User`
  ADD COLUMN `inviteToken` VARCHAR(191) NULL,
  ADD COLUMN `inviteExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `activated` TINYINT(1) NOT NULL DEFAULT 1;

-- Mark existing users as activated
UPDATE `User` SET `activated` = 1;
