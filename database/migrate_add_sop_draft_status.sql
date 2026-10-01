-- Adds DRAFT as a status for SopTemplateRevision, needed for the Author
-- Guides hub (supervisor Save Draft / resume / Publish Now flow). Was
-- applied by hand to local dev during development; this file exists so
-- it's tracked and can be run on other environments.
ALTER TABLE `SopTemplateRevision` MODIFY `status` ENUM('DRAFT','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING';
