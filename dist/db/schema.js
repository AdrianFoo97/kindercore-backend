"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.students = exports.packages = exports.systemSettings = exports.googleConnections = exports.leads = exports.users = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
exports.users = (0, mysql_core_1.mysqlTable)('User', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    email: (0, mysql_core_1.varchar)('email', { length: 191 }).notNull(),
    name: (0, mysql_core_1.varchar)('name', { length: 191 }).notNull(),
    passwordHash: (0, mysql_core_1.varchar)('passwordHash', { length: 191 }).notNull(),
    role: (0, mysql_core_1.mysqlEnum)('role', ['ADMIN', 'STAFF']).notNull().default('STAFF'),
    createdAt: (0, mysql_core_1.datetime)('createdAt', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: (0, mysql_core_1.datetime)('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});
exports.leads = (0, mysql_core_1.mysqlTable)('Lead', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    submittedAt: (0, mysql_core_1.datetime)('submittedAt', { mode: 'date', fsp: 3 }).notNull(),
    childName: (0, mysql_core_1.varchar)('childName', { length: 191 }).notNull(),
    parentPhone: (0, mysql_core_1.varchar)('parentPhone', { length: 191 }).notNull(),
    childDob: (0, mysql_core_1.datetime)('childDob', { mode: 'date', fsp: 3 }).notNull(),
    enrolmentYear: (0, mysql_core_1.int)('enrolmentYear').notNull(),
    status: (0, mysql_core_1.mysqlEnum)('status', ['NEW', 'CONTACTED', 'APPOINTMENT_BOOKED', 'FOLLOW_UP', 'ENROLLED', 'LOST'])
        .notNull()
        .default('NEW'),
    notes: (0, mysql_core_1.text)('notes'),
    appointmentStart: (0, mysql_core_1.datetime)('appointmentStart', { mode: 'date', fsp: 3 }),
    appointmentEnd: (0, mysql_core_1.datetime)('appointmentEnd', { mode: 'date', fsp: 3 }),
    googleEventId: (0, mysql_core_1.varchar)('googleEventId', { length: 191 }),
    googleEventLink: (0, mysql_core_1.text)('googleEventLink'),
    appointmentCreatedByUserId: (0, mysql_core_1.varchar)('appointmentCreatedByUserId', { length: 36 }),
    appointmentIsPlaceholder: (0, mysql_core_1.boolean)('appointmentIsPlaceholder').notNull().default(false),
    lostReason: (0, mysql_core_1.text)('lostReason'),
    relationship: (0, mysql_core_1.varchar)('relationship', { length: 191 }),
    programme: (0, mysql_core_1.varchar)('programme', { length: 191 }),
    preferredAppointmentTime: (0, mysql_core_1.varchar)('preferredAppointmentTime', { length: 191 }),
    addressLocation: (0, mysql_core_1.varchar)('addressLocation', { length: 191 }),
    needsTransport: (0, mysql_core_1.boolean)('needsTransport'),
    howDidYouKnow: (0, mysql_core_1.varchar)('howDidYouKnow', { length: 191 }),
});
exports.googleConnections = (0, mysql_core_1.mysqlTable)('GoogleConnection', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    accessToken: (0, mysql_core_1.text)('accessToken').notNull(),
    refreshToken: (0, mysql_core_1.text)('refreshToken').notNull(),
    expiryDate: (0, mysql_core_1.bigint)('expiryDate', { mode: 'bigint' }).notNull(),
    scope: (0, mysql_core_1.text)('scope').notNull(),
    createdAt: (0, mysql_core_1.datetime)('createdAt', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: (0, mysql_core_1.datetime)('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});
exports.systemSettings = (0, mysql_core_1.mysqlTable)('SystemSetting', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    key: (0, mysql_core_1.varchar)('key', { length: 191 }).notNull(),
    value: (0, mysql_core_1.json)('value').notNull(),
    description: (0, mysql_core_1.varchar)('description', { length: 191 }),
    updatedAt: (0, mysql_core_1.datetime)('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});
exports.packages = (0, mysql_core_1.mysqlTable)('Package', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    year: (0, mysql_core_1.int)('year').notNull(),
    programme: (0, mysql_core_1.varchar)('programme', { length: 191 }).notNull(),
    age: (0, mysql_core_1.int)('age').notNull(),
    name: (0, mysql_core_1.varchar)('name', { length: 191 }).notNull(),
    price: (0, mysql_core_1.float)('price'),
    updatedAt: (0, mysql_core_1.datetime)('updatedAt', { mode: 'date', fsp: 3 }).notNull(),
});
exports.students = (0, mysql_core_1.mysqlTable)('Student', {
    id: (0, mysql_core_1.varchar)('id', { length: 36 }).primaryKey(),
    leadId: (0, mysql_core_1.varchar)('leadId', { length: 36 }).notNull(),
    enrolmentYear: (0, mysql_core_1.int)('enrolmentYear').notNull(),
    enrolmentMonth: (0, mysql_core_1.int)('enrolmentMonth').notNull(),
    packageId: (0, mysql_core_1.varchar)('packageId', { length: 36 }).notNull(),
    enrolledAt: (0, mysql_core_1.datetime)('enrolledAt', { mode: 'date', fsp: 3 }).notNull(),
    notes: (0, mysql_core_1.text)('notes'),
    onboardingProgress: (0, mysql_core_1.json)('onboardingProgress'),
    onboardingCompleted: (0, mysql_core_1.boolean)('onboardingCompleted').notNull().default(false),
    withdrawnAt: (0, mysql_core_1.datetime)('withdrawnAt', { mode: 'date', fsp: 3 }),
    withdrawReason: (0, mysql_core_1.varchar)('withdrawReason', { length: 191 }),
    createdAt: (0, mysql_core_1.datetime)('createdAt', { mode: 'date', fsp: 3 }).notNull(),
});
//# sourceMappingURL=schema.js.map