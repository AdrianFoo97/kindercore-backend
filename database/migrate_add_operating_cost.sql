-- Operating Cost tracking: one row per (year, month, category).
-- Categories are user-managed with an optional grouping for UI rendering.

CREATE TABLE IF NOT EXISTS OperatingCostCategory (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  groupName VARCHAR(60) NOT NULL DEFAULT 'Administrative',
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS OperatingCost (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL,
  categoryId VARCHAR(36) NOT NULL,
  amount FLOAT NOT NULL DEFAULT 0,
  notes TEXT,
  createdAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL,
  UNIQUE KEY uq_oc_year_month_category (year, month, categoryId),
  KEY idx_oc_year (year),
  KEY idx_oc_categoryId (categoryId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
