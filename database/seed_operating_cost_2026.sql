-- ── Seed Operating Cost entries for 2026 (Jan–May actuals) ───────────────────
-- Real recorded figures. Month totals this reproduces:
--   Jan RM 9,454.85 · Feb RM 17,731.03 · Mar RM 13,935.09 · Apr RM 14,718.52 · May RM 9,705.40
--
-- Safe to re-run: groups/categories are matched by NAME (not by id, because a
-- bootstrapped DB and database/seed_categories.sql generate different UUIDs),
-- missing ones are created, and 2026's entries are rebuilt from scratch.
--
--   docker exec -i kindercoreproject-db-1 mysql -uroot -proot kindercore < database/seed_operating_cost_2026.sql

-- ── 1. Groups ────────────────────────────────────────────────────────────────
INSERT INTO `OperatingCostCategoryGroup` (`id`, `name`, `sortOrder`, `isProtected`, `createdAt`, `updatedAt`)
SELECT * FROM (
  SELECT UUID() AS id, 'Administrative'       AS name, 10 AS sortOrder, 0 AS isProtected, NOW(3) AS c, NOW(3) AS u UNION ALL
  SELECT UUID(),       'Sales & Distribution',       20,               0,                NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'HR Benefits',                30,               1,                NOW(3),      NOW(3)
) g
WHERE NOT EXISTS (SELECT 1 FROM `OperatingCostCategoryGroup` x WHERE x.`name` = g.`name`);

SET @g_admin = (SELECT id FROM `OperatingCostCategoryGroup` WHERE `name` = 'Administrative');
SET @g_sales = (SELECT id FROM `OperatingCostCategoryGroup` WHERE `name` = 'Sales & Distribution');
SET @g_hr    = (SELECT id FROM `OperatingCostCategoryGroup` WHERE `name` = 'HR Benefits');

-- ── 2. Categories ────────────────────────────────────────────────────────────
-- The 34 categories in the grid. Names are matched exactly as they appear in
-- the app — including the "Water & Electricty" spelling, which is the real
-- category name and must match for the entries below to attach to it.
INSERT INTO `OperatingCostCategory` (`id`, `name`, `groupId`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT * FROM (
  SELECT UUID() AS id, 'Accounting Fee'              AS name, @g_admin AS groupId,   5 AS sortOrder, NOW(3) AS c, NOW(3) AS u UNION ALL
  SELECT UUID(),       'Water & Electricty',                @g_admin,                7,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Tel, Fax, H/P and Internet',        @g_admin,               10,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Printing & Stationery',             @g_admin,               20,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Postage & Courier',                 @g_admin,               30,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Toll & Parking',                    @g_admin,               40,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Petrol',                            @g_admin,               50,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Upkeep of Motor Vehicle',           @g_admin,               60,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Upkeep of Office Equipment',        @g_admin,               70,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Upkeep of Office',                  @g_admin,               80,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Rental',                            @g_admin,               90,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Water Filter',                      @g_admin,              100,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Road Tax & Insurance',              @g_admin,              110,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Assessment & Quit Rent',            @g_admin,              120,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'License Fee / Stamping Fee',        @g_admin,              130,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Waste Collection',                  @g_admin,              140,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Bank Charges',                      @g_admin,              150,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Depreciation of Fixed Assets',      @g_admin,              160,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Secretary Fee',                     @g_admin,              170,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Cleaning Expenses',                 @g_admin,              180,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Bank Interest',                     @g_admin,              190,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Tax Filing Fee',                    @g_admin,              200,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Event Fee',                         @g_sales,               10,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Training Fee',                      @g_sales,               20,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Advertisement',                     @g_sales,               30,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Travelling',                        @g_sales,               40,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Transportation',                    @g_sales,               50,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Subscription Fee',                  @g_sales,               60,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Photoshoot',                        @g_sales,               70,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'EPF',                               @g_hr,                  10,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'SOCSO',                             @g_hr,                  20,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'EIS',                               @g_hr,                  30,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Medical Benefits',                  @g_hr,                  40,              NOW(3),      NOW(3) UNION ALL
  SELECT UUID(),       'Staff Welfare',                     @g_hr,                  50,              NOW(3),      NOW(3)
) c
WHERE NOT EXISTS (SELECT 1 FROM `OperatingCostCategory` x WHERE x.`name` = c.`name`);

-- ── 3. Monthly budgets on the predictable fixed costs ────────────────────────
-- Only categories that recur every month get a budget; everything else stays
-- NULL ("no budget set") rather than being pinned to a made-up number.
UPDATE `OperatingCostCategory` SET `monthlyBudget` = 4200, `updatedAt` = NOW(3) WHERE `name` = 'Rental';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  400, `updatedAt` = NOW(3) WHERE `name` = 'Accounting Fee';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  700, `updatedAt` = NOW(3) WHERE `name` = 'Water & Electricty';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  180, `updatedAt` = NOW(3) WHERE `name` = 'Tel, Fax, H/P and Internet';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  550, `updatedAt` = NOW(3) WHERE `name` = 'Petrol';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  700, `updatedAt` = NOW(3) WHERE `name` = 'Advertisement';
UPDATE `OperatingCostCategory` SET `monthlyBudget` =  800, `updatedAt` = NOW(3) WHERE `name` = 'Subscription Fee';

-- ── 4. Rebuild 2026 entries ──────────────────────────────────────────────────
DELETE FROM `OperatingCost` WHERE `year` = 2026;

-- month is 0-indexed (0 = Jan). Blank cells in the grid are simply absent rows:
-- "not recorded" is a real state and must not be stored as a zero.
INSERT INTO `OperatingCost` (`id`, `year`, `month`, `categoryId`, `amount`, `createdAt`, `updatedAt`)
SELECT UUID(), 2026, d.`month`, c.`id`, d.`amount`, NOW(3), NOW(3)
FROM (
  -- Administrative
  SELECT 'Accounting Fee'             AS name, 0 AS month,  300.00 AS amount UNION ALL
  SELECT 'Accounting Fee',                     1,           300.00 UNION ALL
  SELECT 'Accounting Fee',                     2,           400.00 UNION ALL
  SELECT 'Accounting Fee',                     3,           400.00 UNION ALL
  SELECT 'Accounting Fee',                     4,           400.00 UNION ALL

  SELECT 'Water & Electricty',                 0,           542.91 UNION ALL
  SELECT 'Water & Electricty',                 1,           651.80 UNION ALL
  SELECT 'Water & Electricty',                 2,           528.45 UNION ALL
  SELECT 'Water & Electricty',                 3,           626.00 UNION ALL
  SELECT 'Water & Electricty',                 4,           934.88 UNION ALL

  SELECT 'Tel, Fax, H/P and Internet',         0,           168.55 UNION ALL
  SELECT 'Tel, Fax, H/P and Internet',         1,           168.55 UNION ALL
  SELECT 'Tel, Fax, H/P and Internet',         2,           168.55 UNION ALL
  SELECT 'Tel, Fax, H/P and Internet',         3,           147.35 UNION ALL
  SELECT 'Tel, Fax, H/P and Internet',         4,           189.75 UNION ALL

  SELECT 'Printing & Stationery',              1,            32.65 UNION ALL
  SELECT 'Printing & Stationery',              3,            18.90 UNION ALL
  SELECT 'Printing & Stationery',              4,            11.50 UNION ALL

  SELECT 'Toll & Parking',                     1,            20.00 UNION ALL

  SELECT 'Petrol',                             0,           522.46 UNION ALL
  SELECT 'Petrol',                             1,           390.33 UNION ALL
  SELECT 'Petrol',                             2,           563.93 UNION ALL
  SELECT 'Petrol',                             3,           544.71 UNION ALL
  SELECT 'Petrol',                             4,           491.89 UNION ALL

  SELECT 'Upkeep of Motor Vehicle',            0,           260.00 UNION ALL
  SELECT 'Upkeep of Motor Vehicle',            1,          2749.00 UNION ALL
  SELECT 'Upkeep of Motor Vehicle',            2,           400.00 UNION ALL
  SELECT 'Upkeep of Motor Vehicle',            4,           666.00 UNION ALL

  SELECT 'Upkeep of Office Equipment',         0,           420.70 UNION ALL
  SELECT 'Upkeep of Office Equipment',         1,          2454.00 UNION ALL
  SELECT 'Upkeep of Office Equipment',         2,           257.44 UNION ALL
  SELECT 'Upkeep of Office Equipment',         4,           460.75 UNION ALL

  SELECT 'Upkeep of Office',                   0,            77.92 UNION ALL
  SELECT 'Upkeep of Office',                   1,          4200.00 UNION ALL
  SELECT 'Upkeep of Office',                   2,            11.20 UNION ALL
  SELECT 'Upkeep of Office',                   3,           195.00 UNION ALL

  SELECT 'Rental',                             0,          4200.00 UNION ALL
  SELECT 'Rental',                             1,          4200.00 UNION ALL
  SELECT 'Rental',                             2,          4200.00 UNION ALL
  SELECT 'Rental',                             3,          4200.00 UNION ALL
  SELECT 'Rental',                             4,          4200.00 UNION ALL

  SELECT 'Road Tax & Insurance',               0,          1598.81 UNION ALL
  SELECT 'License Fee / Stamping Fee',         3,           207.22 UNION ALL
  SELECT 'Waste Collection',                   0,            92.00 UNION ALL
  SELECT 'Bank Charges',                       0,            25.00 UNION ALL
  SELECT 'Tax Filing Fee',                     3,           600.00 UNION ALL

  -- Sales & Distribution
  SELECT 'Event Fee',                          1,           128.90 UNION ALL
  SELECT 'Event Fee',                          2,           788.00 UNION ALL
  SELECT 'Event Fee',                          4,           219.45 UNION ALL

  SELECT 'Training Fee',                       0,           250.00 UNION ALL
  SELECT 'Training Fee',                       1,          1866.00 UNION ALL
  SELECT 'Training Fee',                       2,          5054.00 UNION ALL
  SELECT 'Training Fee',                       3,          5611.20 UNION ALL
  SELECT 'Training Fee',                       4,           310.00 UNION ALL

  SELECT 'Advertisement',                      0,           798.51 UNION ALL
  SELECT 'Advertisement',                      1,           331.00 UNION ALL
  SELECT 'Advertisement',                      2,           500.79 UNION ALL
  SELECT 'Advertisement',                      3,           670.35 UNION ALL
  SELECT 'Advertisement',                      4,           748.78 UNION ALL

  SELECT 'Transportation',                     2,           109.73 UNION ALL
  SELECT 'Transportation',                     3,           450.00 UNION ALL
  SELECT 'Transportation',                     4,            22.59 UNION ALL

  SELECT 'Subscription Fee',                   0,           197.99 UNION ALL
  SELECT 'Subscription Fee',                   1,           238.80 UNION ALL
  SELECT 'Subscription Fee',                   2,           953.00 UNION ALL
  SELECT 'Subscription Fee',                   3,           779.49 UNION ALL
  SELECT 'Subscription Fee',                   4,          1049.81 UNION ALL

  -- HR Benefits
  SELECT 'Medical Benefits',                   3,            80.00 UNION ALL
  SELECT 'Staff Welfare',                      3,           188.30
) d
JOIN `OperatingCostCategory` c ON c.`name` = d.`name`;

-- ── 5. Reconciliation ────────────────────────────────────────────────────────
SELECT `month`, ROUND(SUM(`amount`), 2) AS total, COUNT(*) AS entries
FROM `OperatingCost` WHERE `year` = 2026 GROUP BY `month` ORDER BY `month`;
