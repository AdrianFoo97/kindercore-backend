-- Add a teacher-pinned focus flag to TeacherMissionProgress. When true,
-- the mission appears in the teacher's "Current Targets" list on the
-- Career page. Independent of status — a target can be Not Started, In
-- Progress, or Awaiting Review.
ALTER TABLE `TeacherMissionProgress`
  ADD COLUMN `isTargeted` TINYINT(1) NOT NULL DEFAULT 0;
