-- Per-category default amount (prefill when recording) and monthly budget.
-- Both nullable so existing rows keep their current behaviour until edited.

ALTER TABLE OperatingCostCategory
  ADD COLUMN defaultAmount FLOAT NULL AFTER sortOrder,
  ADD COLUMN monthlyBudget FLOAT NULL AFTER defaultAmount;
