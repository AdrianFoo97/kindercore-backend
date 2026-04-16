-- Add a protection flag to operating cost main categories so certain system
-- groups (e.g. HR Benefits) can be renamed but never deleted.
ALTER TABLE `OperatingCostCategoryGroup`
  ADD COLUMN `isProtected` TINYINT(1) NOT NULL DEFAULT 0;

-- Seed the HR Benefits main category as a protected entry. Sort order placed
-- after the existing groups; the user can reorder it from the UI.
INSERT INTO `OperatingCostCategoryGroup` (`id`, `name`, `sortOrder`, `isProtected`, `createdAt`, `updatedAt`)
SELECT UUID(), 'HR Benefits', COALESCE(MAX(`sortOrder`), 0) + 10, 1, NOW(3), NOW(3)
FROM `OperatingCostCategoryGroup`;
