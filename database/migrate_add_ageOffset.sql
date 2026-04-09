-- Add ageOffset column to Student table
-- Replaces the previous ageOverride approach (absolute age) with a relative offset
-- from the DOB-calculated age, so age auto-advances each year while keeping the offset.

ALTER TABLE Student
  ADD COLUMN ageOffset INT NOT NULL DEFAULT 0;
