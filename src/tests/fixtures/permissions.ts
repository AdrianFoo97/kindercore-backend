import { users, teachers, positions, authRoles, authRoleModules, authRoleViews } from '../../db/schema.js';

// Test data for the module/view permission tests. Two ways a user can get
// access, exactly as resolveGrants() reads them:
//   direct:   User.authRoleId                                → "Office Staff" (HR module)
//   position: User.teacherId → Teacher → Position.authRoleId → "Class Teacher" (OPERATION module + SOP view)
//
//   office   — direct role only
//   teacher  — via position only
//   both     — direct role AND a teaching position (grants combine)
//   nobody   — no role at all

const NOW = new Date('2026-01-01T00:00:00Z');

export const ROLE = { office: 'role-office', classTeacher: 'role-class-teacher' } as const;
export const USER_ID = { office: 'u-office', teacher: 'u-teacher', both: 'u-both', nobody: 'u-nobody' } as const;

export const authRoleRows: (typeof authRoles.$inferInsert)[] = [
  { id: ROLE.office, name: 'Office Staff', createdAt: NOW, updatedAt: NOW },
  { id: ROLE.classTeacher, name: 'Class Teacher', createdAt: NOW, updatedAt: NOW },
];

export const moduleRows: (typeof authRoleModules.$inferInsert)[] = [
  { id: 'arm-1', authRoleId: ROLE.office, module: 'HR', createdAt: NOW },
  { id: 'arm-2', authRoleId: ROLE.classTeacher, module: 'OPERATION', createdAt: NOW },
];

export const viewRows: (typeof authRoleViews.$inferInsert)[] = [
  { id: 'arv-1', authRoleId: ROLE.classTeacher, view: 'OPERATION_SOP_APPROVE', createdAt: NOW },
];

export const positionRows: (typeof positions.$inferInsert)[] = [
  { positionId: 'P-CT', name: 'Class Teacher', authRoleId: ROLE.classTeacher, createdAt: NOW, updatedAt: NOW },
  { positionId: 'P-NONE', name: 'Helper (no access role)', authRoleId: null, createdAt: NOW, updatedAt: NOW },
];

export const teacherRows: (typeof teachers.$inferInsert)[] = [
  { id: 't-1', name: 'Tina Teacher', color: '#7c3aed', positionId: 'P-CT', createdAt: NOW, updatedAt: NOW },
  { id: 't-2', name: 'Bea Both', color: '#2563eb', positionId: 'P-CT', createdAt: NOW, updatedAt: NOW },
];

const user = (id: string, extra: Partial<typeof users.$inferInsert>): typeof users.$inferInsert => ({
  id, email: `${id}@kindertech.test`, name: id, passwordHash: 'x', role: 'USER', activated: true,
  createdAt: NOW, updatedAt: NOW, ...extra,
});

export const userRows: (typeof users.$inferInsert)[] = [
  user(USER_ID.office, { authRoleId: ROLE.office }),
  user(USER_ID.teacher, { teacherId: 't-1' }),
  user(USER_ID.both, { authRoleId: ROLE.office, teacherId: 't-2' }),
  user(USER_ID.nobody, {}),
];
