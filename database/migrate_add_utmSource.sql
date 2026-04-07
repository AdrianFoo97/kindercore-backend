-- Migration: add utmSource to Lead table
-- Captures utm_source URL parameter for tracking traffic source (QR codes, ads, etc.)
-- Run once against the existing database.

ALTER TABLE `Lead`
  ADD COLUMN `utmSource` VARCHAR(191) NULL
  AFTER `ctaSource`;
