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
  lostReason: text('lostReason'),
  relationship: varchar('relationship', { length: 191 }),
  programme: varchar('programme', { length: 191 }),
  preferredAppointmentTime: varchar('preferredAppointmentTime', { length: 191 }),
  addressLocation: varchar('addressLocation', { length: 191 }),
  needsTransport: boolean('needsTransport'),
  howDidYouKnow: varchar('howDidYouKnow', { length: 191 }),
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
  notes: text('notes'),
  onboardingProgress: json('onboardingProgress'),
  onboardingCompleted: boolean('onboardingCompleted').notNull().default(false),
  withdrawnAt: datetime('withdrawnAt', { mode: 'date', fsp: 3 }),
  withdrawReason: varchar('withdrawReason', { length: 191 }),
  createdAt: datetime('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});
