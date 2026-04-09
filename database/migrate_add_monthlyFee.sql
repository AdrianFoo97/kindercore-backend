-- Migration: add monthlyFee and feeOverridden to Student table
-- monthlyFee: the actual monthly fee for this student (defaults to package price)
-- feeOverridden: true if the fee was manually set (e.g. discount)

ALTER TABLE `Student`
  ADD COLUMN `monthlyFee` FLOAT NULL AFTER `notes`,
  ADD COLUMN `feeOverridden` TINYINT(1) NOT NULL DEFAULT 0 AFTER `monthlyFee`;

-- Backfill existing students with their package price
UPDATE `Student` s
JOIN `Package` p ON s.packageId = p.id
SET s.monthlyFee = p.price
WHERE s.monthlyFee IS NULL;
