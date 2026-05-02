import {
  mysqlTable,
  varchar,
  datetime,
  int,
  boolean,
  text,
  json,
  bigint,
  float,
  mysqlEnum,
} from 'drizzle-orm/mysql-core';

export const users = mysqlTable('User', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  passwordHash: varchar('passwordHash', { length: 191 }).notNull(),
  role: mysqlEnum('role', ['SUPERADMIN', 'ADMIN', 'STAFF']).notNull().default('STAFF'),
  inviteToken: varchar('inviteToken', { length: 191 }),
  inviteExpiresAt: datetime('inviteExpiresAt', { mode: 'date', fsp: 3 }),
  activated: boolean('activated').notNull().default(false),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const leads = mysqlTable('Lead', {
  id: varchar('id', { length: 36 }).primaryKey(),
  submittedAt: datetime('submittedAt', { mode: 'date', fsp: 3 }).notNull(),
  childName: varchar('childName', { length: 191 }).notNull(),
  parentPhone: varchar('parentPhone', { length: 191 }).notNull(),
  childDob: datetime('childDob', { mode: 'date', fsp: 3 }).notNull(),
  enrolmentYear: int('enrolmentYear').notNull(),
  status: mysqlEnum('status', ['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST', 'REJECTED'])
    .notNull()
    .default('NEW'),
  notes: text('notes'),
  appointmentStart: datetime('appointmentStart', { mode: 'date', fsp: 3 }),
  appointmentEnd: datetime('appointmentEnd', { mode: 'date', fsp: 3 }),
  googleEventId: varchar('googleEventId', { length: 191 }),
  googleEventLink: text('googleEventLink'),
  appointmentCreatedByUserId: varchar('appointmentCreatedByUserId', { length: 36 }),
  appointmentIsPlaceholder: boolean('appointmentIsPlaceholder').notNull().default(false),
  attended: boolean('attended').notNull().default(false),
  // Explicit analytics columns — source of truth for Lead Quality & visit
  // outcome. Derived by the backend on every write from status/lostReason/
  // attended so the frontend never has to recompute.
  //   isQualified = false only when status=REJECTED or LOST+cold-system-reason
  //   visitOutcome = 'ATTENDED' stored when the visit happened
  //   visitOutcome = 'NO_SHOW'  only derived at query time (past appointment,
  //                             no ATTENDED outcome, not in a state that
  //                             implies the visit)
  isQualified: boolean('isQualified').notNull().default(true),
  visitOutcome: mysqlEnum('visitOutcome', ['ATTENDED', 'NO_SHOW']),
  statusChangedAt: datetime('statusChangedAt', { mode: 'date', fsp: 3 }),
  lostReason: text('lostReason'),
  relationship: varchar('relationship', { length: 191 }),
  programme: varchar('programme', { length: 191 }),
  preferredAppointmentTime: varchar('preferredAppointmentTime', { length: 191 }),
  addressLocation: varchar('addressLocation', { length: 191 }),
  needsTransport: boolean('needsTransport'),
  howDidYouKnow: varchar('howDidYouKnow', { length: 191 }),
  ctaSource: varchar('ctaSource', { length: 50 }),
  utmSource: varchar('utmSource', { length: 191 }),
  leadTemperature: mysqlEnum('leadTemperature', ['COOL', 'WARM', 'HOT']),
  deletedAt: datetime('deletedAt', { mode: 'date', fsp: 3 }),
});

export const googleConnections = mysqlTable('GoogleConnection', {
  id: varchar('id', { length: 36 }).primaryKey(),
  accessToken: text('accessToken').notNull(),
  refreshToken: text('refreshToken').notNull(),
  expiryDate: bigint('expiryDate', { mode: 'bigint' }).notNull(),
  scope: text('scope').notNull(),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const systemSettings = mysqlTable('SystemSetting', {
  id: varchar('id', { length: 36 }).primaryKey(),
  key: varchar('key', { length: 191 }).notNull(),
  value: json('value').notNull(),
  description: varchar('description', { length: 191 }),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const packages = mysqlTable('Package', {
  id: varchar('id', { length: 36 }).primaryKey(),
  year: int('year').notNull(),
  programme: varchar('programme', { length: 191 }).notNull(),
  age: int('age').notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  price: float('price'),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const students = mysqlTable('Student', {
  id: varchar('id', { length: 36 }).primaryKey(),
  leadId: varchar('leadId', { length: 36 }).notNull(),
  enrolmentYear: int('enrolmentYear').notNull(),
  enrolmentMonth: int('enrolmentMonth').notNull(),
  packageId: varchar('packageId', { length: 36 }).notNull(),
  enrolledAt: datetime('enrolledAt', { mode: 'date', fsp: 3 }).notNull(),
  startDate: datetime('startDate', { mode: 'date', fsp: 3 }),
  notes: text('notes'),
  monthlyFee: float('monthlyFee'),
  feeOverridden: boolean('feeOverridden').notNull().default(false),
  ageOffset: int('ageOffset').notNull().default(0),
  childName: varchar('childName', { length: 191 }),
  childDob: datetime('childDob', { mode: 'date', fsp: 3 }),
  onboardingProgress: json('onboardingProgress'),
  onboardingCompleted: boolean('onboardingCompleted').notNull().default(false),
  withdrawnAt: datetime('withdrawnAt', { mode: 'date', fsp: 3 }),
  withdrawReason: varchar('withdrawReason', { length: 191 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

// One package-enrollment period for a student. Multiple rows form a
// non-overlapping timeline; the row with `endDate=null` is the current
// enrollment. Past rows are immutable history. Revenue for a given month
// is computed from whichever row covers the month-end cutoff.
//
// On the Student row, `packageId`/`monthlyFee`/`feeOverridden` are kept
// in sync with the latest active enrollment (denormalized for fast list
// queries), but enrollments is the source of truth for history.
export const studentEnrollments = mysqlTable('StudentEnrollment', {
  id: varchar('id', { length: 36 }).primaryKey(),
  studentId: varchar('studentId', { length: 36 }).notNull(),
  packageId: varchar('packageId', { length: 36 }).notNull(),
  monthlyFee: float('monthlyFee').notNull(),
  feeOverridden: boolean('feeOverridden').notNull().default(false),
  // Inclusive start. `endDate` is exclusive; null = currently active.
  startDate: datetime('startDate', { mode: 'date', fsp: 3 }).notNull(),
  endDate: datetime('endDate', { mode: 'date', fsp: 3 }),
  reason: varchar('reason', { length: 191 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const positions = mysqlTable('Position', {
  positionId: varchar('positionId', { length: 10 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  titleWeight: int('titleWeight').notNull().default(0),
  basicSalary: float('basicSalary').notNull().default(0),
  maxLevel: int('maxLevel').notNull().default(5),
  sortOrder: int('sortOrder').notNull().default(0),
  // Whether this position is part of the teacher's career progression
  // ladder. Off for "support"/"non-progression" roles like "Staff" that
  // should be excluded from the Career Journey Map. Defaults true.
  inCareerProgression: boolean('inCareerProgression').notNull().default(true),
  // Optional title-badge image URL — shown beside the Career Journey on
  // the teacher career page. Admin uploads/sets this per position.
  badgeUrl: varchar('badgeUrl', { length: 500 }),
  // Star color (hex, e.g. "#C0C0C0" for silver, "#FFD700" for gold) —
  // when a teacher completes all missions in an achievement category at
  // this position, the achievement is rendered with a star in this color.
  // Lets each tier feel distinct (silver → gold → blue → ...).
  starColor: varchar('starColor', { length: 20 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const levelIncentives = mysqlTable('LevelIncentive', {
  id: varchar('id', { length: 36 }).primaryKey(),
  positionId: varchar('positionId', { length: 10 }).notNull(),
  level: int('level').notNull(),
  amount: float('amount').notNull().default(0),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const teachers = mysqlTable('Teacher', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  isActive: boolean('isActive').notNull().default(true),
  allowedSubjectIds: json('allowedSubjectIds'),
  allowedClassroomIds: json('allowedClassroomIds'),
  workStartMinute: int('workStartMinute'),
  workEndMinute: int('workEndMinute'),
  workDays: json('workDays'),
  positionId: varchar('positionId', { length: 10 }),
  level: int('level').default(0),
  isFixedSalary: boolean('isFixedSalary').notNull().default(false),
  fixedSalaryAmount: float('fixedSalaryAmount'),
  salaryType: varchar('salaryType', { length: 20 }).default('formula'),
  hourlyRate: float('hourlyRate'),
  excludeFromProfitShare: boolean('excludeFromProfitShare').notNull().default(false),
  overrideProfitShareWeight: boolean('overrideProfitShareWeight').notNull().default(false),
  customProfitShareWeight: float('customProfitShareWeight'),
  hasEpf: boolean('hasEpf').notNull().default(true),
  hasSocso: boolean('hasSocso').notNull().default(true),
  hasEis: boolean('hasEis').notNull().default(true),
  phone: varchar('phone', { length: 50 }),
  employmentType: varchar('employmentType', { length: 20 }).default('full-time'),
  resignedAt: datetime('resignedAt', { mode: 'date', fsp: 3 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const allowanceTypes = mysqlTable('AllowanceType', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  isDefault: boolean('isDefault').notNull().default(false),
  sortOrder: int('sortOrder').notNull().default(0),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const teacherAllowances = mysqlTable('TeacherAllowance', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teacherId: varchar('teacherId', { length: 36 }).notNull(),
  allowanceTypeId: varchar('allowanceTypeId', { length: 36 }).notNull(),
  amount: float('amount').notNull().default(0),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const careerRecords = mysqlTable('CareerRecord', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teacherId: varchar('teacherId', { length: 36 }).notNull(),
  positionId: varchar('positionId', { length: 10 }).notNull(),
  level: int('level').notNull().default(0),
  effectiveDate: datetime('effectiveDate', { mode: 'date', fsp: 3 }).notNull(),
  notes: text('notes'),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

// Mission categories — admin-managed capability buckets that drive the
// achievement badges on the teacher's career page. Code is the stable
// identifier used by careerMissions; presentation (name, achievementName,
// icon, color) is editable from the settings UI.
export const missionCategories = mysqlTable('MissionCategory', {
  code: varchar('code', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  achievementName: varchar('achievementName', { length: 191 }).notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }).notNull(),
  color: varchar('color', { length: 20 }).notNull(),
  sortOrder: int('sortOrder').notNull().default(0),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

// Capability missions configured per position. Defines what a teacher must
// demonstrate before they can be promoted from this position. Soft-deleted
// when their position is removed so historical TeacherMissionProgress rows
// can still resolve the mission name.
//
// `category` references MissionCategory.code as a free-string FK. Loosened
// from an enum so admins can add categories without a code deploy.
export const careerMissions = mysqlTable('CareerMission', {
  id: varchar('id', { length: 36 }).primaryKey(),
  positionId: varchar('positionId', { length: 10 }).notNull(),
  title: varchar('title', { length: 191 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  // Promotion-rationale copy: WHY completing this mission moves the teacher
  // closer to the next position. Distinct from `description` ("what to do").
  whyItMatters: text('whyItMatters'),
  difficulty: mysqlEnum('difficulty', ['BASIC', 'INTERMEDIATE', 'ADVANCED']).notNull().default('BASIC'),
  evidenceRequirements: text('evidenceRequirements'),
  required: boolean('required').notNull().default(true),
  // High-priority missions surface a "Priority" badge on the teacher's
  // Mission Board so they're visually pulled to the top of the list.
  highPriority: boolean('highPriority').notNull().default(false),
  requiresApproval: boolean('requiresApproval').notNull().default(true),
  displayOrder: int('displayOrder').notNull().default(0),
  deletedAt: datetime('deletedAt', { mode: 'date', fsp: 3 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

// Monthly appraisal score per teacher. Average of recent months drives the
// "Average appraisal > 75%" promotion gate on the Teacher Career Page.
// One row per (teacherId, year, month) pair; month is 0–11 to match JS.
export const teacherAppraisals = mysqlTable('TeacherAppraisal', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teacherId: varchar('teacherId', { length: 36 }).notNull(),
  year: int('year').notNull(),
  month: int('month').notNull(),
  score: float('score').notNull(),
  notes: text('notes'),
  evaluatedBy: varchar('evaluatedBy', { length: 191 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

// Per-teacher progress on a single mission. One row per (teacherId, missionId)
// pair. Rows persist even after a mission is soft-deleted so we can show
// historical career progression on the teacher's profile.
export const teacherMissionProgress = mysqlTable('TeacherMissionProgress', {
  id: varchar('id', { length: 36 }).primaryKey(),
  teacherId: varchar('teacherId', { length: 36 }).notNull(),
  missionId: varchar('missionId', { length: 36 }).notNull(),
  status: mysqlEnum('status', ['PENDING', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED']).notNull().default('PENDING'),
  evidenceCount: int('evidenceCount').notNull().default(0),
  evidenceTotal: int('evidenceTotal').notNull().default(0),
  notes: text('notes'),
  startedAt: datetime('startedAt', { mode: 'date', fsp: 3 }),
  submittedAt: datetime('submittedAt', { mode: 'date', fsp: 3 }),
  approvedAt: datetime('approvedAt', { mode: 'date', fsp: 3 }),
  approvedBy: varchar('approvedBy', { length: 36 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const operatingCostCategoryGroups = mysqlTable('OperatingCostCategoryGroup', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  sortOrder: int('sortOrder').notNull().default(0),
  isProtected: boolean('isProtected').notNull().default(false),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const operatingCostCategories = mysqlTable('OperatingCostCategory', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  groupId: varchar('groupId', { length: 36 }).notNull(),
  sortOrder: int('sortOrder').notNull().default(0),
  defaultAmount: float('defaultAmount'),
  monthlyBudget: float('monthlyBudget'),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const operatingCosts = mysqlTable('OperatingCost', {
  id: varchar('id', { length: 36 }).primaryKey(),
  year: int('year').notNull(),
  month: int('month').notNull(),
  categoryId: varchar('categoryId', { length: 36 }).notNull(),
  amount: float('amount').notNull().default(0),
  notes: text('notes'),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const classrooms = mysqlTable('Classroom', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  capacity: int('capacity'),
  startMinute: int('startMinute'),
  endMinute: int('endMinute'),
  daysOfWeek: json('daysOfWeek'),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const subjects = mysqlTable('Subject', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  lessonsPerWeek: int('lessonsPerWeek'),
  defaultDuration: int('defaultDuration').default(60),
  classLessons: json('classLessons'),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const plannerTasks = mysqlTable('PlannerTask', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  category: mysqlEnum('category', ['TEACHING', 'ADMIN', 'DUTY', 'BREAK', 'OTHER']).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  defaultDuration: int('defaultDuration').notNull().default(30),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const scheduleBlocks = mysqlTable('ScheduleBlock', {
  id: varchar('id', { length: 36 }).primaryKey(),
  weekDate: datetime('weekDate', { mode: 'date', fsp: 3 }).notNull(),
  dayOfWeek: int('dayOfWeek').notNull(),
  startMinute: int('startMinute').notNull(),
  durationMinutes: int('durationMinutes').notNull().default(30),
  teacherId: varchar('teacherId', { length: 36 }),
  subjectId: varchar('subjectId', { length: 36 }),
  taskId: varchar('taskId', { length: 36 }),
  classroomId: varchar('classroomId', { length: 36 }),
  assignedTeacherIds: json('assignedTeacherIds'),
  notes: text('notes'),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});

export const savedTimetables = mysqlTable('SavedTimetable', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  blocks: json('blocks').notNull(),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});
