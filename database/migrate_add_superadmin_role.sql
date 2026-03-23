-- Add SUPERADMIN role to User table
ALTER TABLE `User` MODIFY COLUMN `role` ENUM('SUPERADMIN','ADMIN','STAFF') NOT NULL DEFAULT 'STAFF';

-- Update the main admin to SUPERADMIN
UPDATE `User` SET `role` = 'SUPERADMIN' WHERE `email` = 'admin@kindercore.com';
