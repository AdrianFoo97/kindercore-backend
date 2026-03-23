-- Migration: add startDate to Student table
-- Run once against the existing database.

ALTER TABLE `Student`
  ADD COLUMN `startDate` DATETIME(3) NULL
  AFTER `enrolledAt`;
