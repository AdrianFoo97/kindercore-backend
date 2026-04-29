-- Adds the StudentEnrollment table, which owns the per-period package +
-- monthly-fee state for a student. A student can have many rows over time;
-- they form a non-overlapping timeline. The row with endDate IS NULL is the
-- current enrollment.
--
-- Why: the Student row stores a single packageId / monthlyFee, which can't
-- represent a student who changed package mid-year. Past months would be
-- retroactively re-priced if we mutated the Student row alone. Enrollments
-- preserve history so revenue for any past month stays stable forever.
--
-- The Student row's packageId / monthlyFee / feeOverridden remain as a
-- denormalised "current" cache for fast list views, kept in sync by the
-- API on every enrollment change.

CREATE TABLE IF NOT EXISTS StudentEnrollment (
  id            VARCHAR(36)  NOT NULL,
  studentId     VARCHAR(36)  NOT NULL,
  packageId     VARCHAR(36)  NOT NULL,
  monthlyFee    FLOAT        NOT NULL,
  feeOverridden TINYINT(1)   NOT NULL DEFAULT 0,
  startDate     DATETIME(3)  NOT NULL,
  endDate       DATETIME(3)  NULL,
  reason        VARCHAR(191) NULL,
  createdAt     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  INDEX StudentEnrollment_studentId_idx (studentId),
  INDEX StudentEnrollment_period_idx (studentId, startDate, endDate)
);

-- Backfill: create one initial enrollment row per existing student covering
-- their full active period. startDate prefers the student's recorded
-- startDate, falling back to enrolledAt for older rows. endDate uses
-- withdrawnAt so withdrawn students get a closed period.
INSERT INTO StudentEnrollment
  (id, studentId, packageId, monthlyFee, feeOverridden, startDate, endDate, reason, createdAt)
SELECT
  UUID(),
  s.id,
  s.packageId,
  COALESCE(s.monthlyFee, 0)            AS monthlyFee,
  s.feeOverridden                       AS feeOverridden,
  COALESCE(s.startDate, s.enrolledAt)   AS startDate,
  s.withdrawnAt                         AS endDate,
  NULL,
  s.createdAt
FROM Student s
WHERE NOT EXISTS (
  SELECT 1 FROM StudentEnrollment e WHERE e.studentId = s.id
);
