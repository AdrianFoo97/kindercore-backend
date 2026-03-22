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
  role: mysqlEnum('role', ['ADMIN', 'STAFF']).notNull().default('STAFF'),
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
  status: mysqlEnum('status', ['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST'])
    .notNull()
    .default('NEW'),
  notes: text('notes'),
  appointmentStart: datetime('appointmentStart', { mode: 'date', fsp: 3 }),
  appointmentEnd: datetime('appointmentEnd', { mode: 'date', fsp: 3 }),
  googleEventId: varchar('googleEventId', { length: 191 }),
  googleEventLink: text('googleEventLink'),
  appointmentCreatedByUserId: varchar('appointmentCreatedByUserId', { length: 36 }),
  appointmentIsPlaceholder: boolean('appointmentIsPlaceholder').notNull().default(false),
  statusChangedAt: datetime('statusChangedAt', { mode: 'date', fsp: 3 }),
  lostReason: text('lostReason'),
  relationship: varchar('relationship', { length: 191 }),
  programme: varchar('programme', { length: 191 }),
  preferredAppointmentTime: varchar('preferredAppointmentTime', { length: 191 }),
  addressLocation: varchar('addressLocation', { length: 191 }),
  needsTransport: boolean('needsTransport'),
  howDidYouKnow: varchar('howDidYouKnow', { length: 191 }),
  ctaSource: varchar('ctaSource', { length: 50 }),
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
  onboardingProgress: json('onboardingProgress'),
  onboardingCompleted: boolean('onboardingCompleted').notNull().default(false),
  withdrawnAt: datetime('withdrawnAt', { mode: 'date', fsp: 3 }),
  withdrawReason: varchar('withdrawReason', { length: 191 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
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
