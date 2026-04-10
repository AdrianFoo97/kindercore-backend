-- Add per-student child info to support siblings sharing one Lead.
-- These columns are nullable: existing solo students leave them NULL and the
-- API falls back to Lead.childName / Lead.childDob.
-- Sibling students populate these so each child has their own name + DOB
-- while still sharing the Lead row (parent contact, marketing source, etc.).

ALTER TABLE Student
  ADD COLUMN childName VARCHAR(191) NULL,
  ADD COLUMN childDob DATETIME(3)   NULL;

-- Drop the legacy 1:1 unique constraint on leadId so multiple siblings
-- can share a single Lead row. Replace with a non-unique index for joins.
ALTER TABLE Student
  DROP INDEX Student_leadId_key,
  ADD INDEX Student_leadId_idx (leadId);
