ALTER TABLE `Teacher`
  ADD COLUMN `overrideProfitShareWeight` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `customProfitShareWeight` FLOAT NULL;
