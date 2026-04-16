-- ── Seed Operating Cost Category Groups & Categories ─────────────────────────
-- Run this on a fresh database AFTER the tables have been created.
-- Safe to run multiple times: INSERT IGNORE skips rows that already exist
-- (UUIDs are fixed so duplicates are detected by the id primary key).

SET @g_admin   = 'oc-group-0001-0000-0000-000000000001';
SET @g_sales   = 'oc-group-0002-0000-0000-000000000002';
SET @g_hr      = 'oc-group-0003-0000-0000-000000000003';

-- ── Groups ────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `OperatingCostCategoryGroup` (`id`, `name`, `sortOrder`, `isProtected`, `createdAt`, `updatedAt`) VALUES
  (@g_admin, 'Administrative',      10, 0, NOW(3), NOW(3)),
  (@g_sales, 'Sales & Distribution',20, 0, NOW(3), NOW(3)),
  (@g_hr,    'HR Benefits',         30, 1, NOW(3), NOW(3));

-- ── Administrative categories ─────────────────────────────────────────────────
INSERT IGNORE INTO `OperatingCostCategory` (`id`, `name`, `groupId`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  ('oc-cat-adm-001', 'Tel, Fax, H/P and Internet',    @g_admin,  10, NOW(3), NOW(3)),
  ('oc-cat-adm-002', 'Printing & Stationery',          @g_admin,  20, NOW(3), NOW(3)),
  ('oc-cat-adm-003', 'Postage & Courier',              @g_admin,  30, NOW(3), NOW(3)),
  ('oc-cat-adm-004', 'Toll & Parking',                 @g_admin,  40, NOW(3), NOW(3)),
  ('oc-cat-adm-005', 'Petrol',                         @g_admin,  50, NOW(3), NOW(3)),
  ('oc-cat-adm-006', 'Upkeep of Motor Vehicle',        @g_admin,  60, NOW(3), NOW(3)),
  ('oc-cat-adm-007', 'Upkeep of Office Equipment',     @g_admin,  70, NOW(3), NOW(3)),
  ('oc-cat-adm-008', 'Upkeep of Office',               @g_admin,  80, NOW(3), NOW(3)),
  ('oc-cat-adm-009', 'Rental',                         @g_admin,  90, NOW(3), NOW(3)),
  ('oc-cat-adm-010', 'Water Filter',                   @g_admin, 100, NOW(3), NOW(3)),
  ('oc-cat-adm-011', 'Road Tax & Insurance',           @g_admin, 110, NOW(3), NOW(3)),
  ('oc-cat-adm-012', 'Assessment & Quit Rent',         @g_admin, 120, NOW(3), NOW(3)),
  ('oc-cat-adm-013', 'License Fee / Stamping Fee',     @g_admin, 130, NOW(3), NOW(3)),
  ('oc-cat-adm-014', 'Waste Collection',               @g_admin, 140, NOW(3), NOW(3)),
  ('oc-cat-adm-015', 'Bank Charges',                   @g_admin, 150, NOW(3), NOW(3)),
  ('oc-cat-adm-016', 'Depreciation of Fixed Assets',   @g_admin, 160, NOW(3), NOW(3)),
  ('oc-cat-adm-017', 'Secretary Fee',                  @g_admin, 170, NOW(3), NOW(3)),
  ('oc-cat-adm-018', 'Cleaning Expenses',              @g_admin, 180, NOW(3), NOW(3)),
  ('oc-cat-adm-019', 'Bank Interest',                  @g_admin, 190, NOW(3), NOW(3));

-- ── Sales & Distribution categories ──────────────────────────────────────────
INSERT IGNORE INTO `OperatingCostCategory` (`id`, `name`, `groupId`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  ('oc-cat-sal-001', 'Event Fee',        @g_sales, 10, NOW(3), NOW(3)),
  ('oc-cat-sal-002', 'Training Fee',     @g_sales, 20, NOW(3), NOW(3)),
  ('oc-cat-sal-003', 'Advertisement',    @g_sales, 30, NOW(3), NOW(3)),
  ('oc-cat-sal-004', 'Travelling',       @g_sales, 40, NOW(3), NOW(3)),
  ('oc-cat-sal-005', 'Transportation',   @g_sales, 50, NOW(3), NOW(3)),
  ('oc-cat-sal-006', 'Subscription Fee', @g_sales, 60, NOW(3), NOW(3)),
  ('oc-cat-sal-007', 'Photoshoot',       @g_sales, 70, NOW(3), NOW(3));

-- ── HR Benefits categories ────────────────────────────────────────────────────
INSERT IGNORE INTO `OperatingCostCategory` (`id`, `name`, `groupId`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  ('oc-cat-hr-001', 'EPF',              @g_hr, 10, NOW(3), NOW(3)),
  ('oc-cat-hr-002', 'SOCSO',            @g_hr, 20, NOW(3), NOW(3)),
  ('oc-cat-hr-003', 'EIS',              @g_hr, 30, NOW(3), NOW(3)),
  ('oc-cat-hr-004', 'Medical Benefits', @g_hr, 40, NOW(3), NOW(3)),
  ('oc-cat-hr-005', 'Staff Welfare',    @g_hr, 50, NOW(3), NOW(3));
