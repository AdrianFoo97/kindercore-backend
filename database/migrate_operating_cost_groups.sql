-- Promote "group" from a string column to a first-class table so users can
-- add/rename/delete main categories independently of the items within them.

CREATE TABLE IF NOT EXISTS OperatingCostCategoryGroup (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL,
  UNIQUE KEY uq_ocg_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed group rows from the distinct groupNames currently stored on categories.
-- ROW_NUMBER seeds a deterministic sortOrder (10, 20, ...).
INSERT INTO OperatingCostCategoryGroup (id, name, sortOrder, createdAt, updatedAt)
SELECT UUID(), g.groupName, (@rn := @rn + 10), NOW(3), NOW(3)
FROM (SELECT DISTINCT groupName FROM OperatingCostCategory ORDER BY groupName) g,
     (SELECT @rn := 0) r
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Add groupId FK column to OperatingCostCategory (nullable during backfill).
ALTER TABLE OperatingCostCategory ADD COLUMN groupId VARCHAR(36) NULL AFTER name;

-- Backfill groupId by matching names.
UPDATE OperatingCostCategory c
JOIN OperatingCostCategoryGroup g ON c.groupName = g.name
SET c.groupId = g.id;

-- Enforce NOT NULL now that every row has a group.
ALTER TABLE OperatingCostCategory MODIFY COLUMN groupId VARCHAR(36) NOT NULL;

-- Drop the legacy groupName column.
ALTER TABLE OperatingCostCategory DROP COLUMN groupName;

-- Index for fast group-based lookups.
CREATE INDEX idx_oc_cat_groupId ON OperatingCostCategory (groupId);
