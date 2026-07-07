-- Add `description` column to the Position table.
-- Plain-text, nullable so existing positions don't need backfill.

ALTER TABLE Position
  ADD COLUMN description TEXT NULL AFTER starColor;
