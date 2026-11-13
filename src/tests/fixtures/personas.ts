import bcrypt from 'bcryptjs';
import { authRoleModules, authRoles, positions, teachers, users } from '../../db/schema.js';

// The people in the access-control tests, each with exactly one kind of
// access — granted the way the app grants it (an Access Role carrying a
// module), so the real permission lookup runs:
//   teacher  — a plain teacher, no modules (Tina, record t-tina)
//   owner    — another plain teacher whose record the others try to open (Olive, t-olive)
//   hr / finance / analysis — office staff with just that one module
//   admin    — an Admin

export const PERSONA_PASSWORD = 'Persona-Pass-42';
const NOW = new Date('2026-01-01T00:00:00Z');

export const PERSONAS = {
  teacher: { id: 'p-teacher', email: 'tina@kindertech.test', teacherId: 't-tina' },
  owner: { id: 'p-owner', email: 'olive@kindertech.test', teacherId: 't-olive' },
  hr: { id: 'p-hr', email: 'hana.hr@kindertech.test', module: 'HR' },
  finance: { id: 'p-finance', email: 'fiona.finance@kindertech.test', module: 'FINANCE' },
  analysis: { id: 'p-analysis', email: 'andy.analysis@kindertech.test', module: 'ANALYSIS' },
  admin: { id: 'p-admin', email: 'ada.admin@kindertech.test' },
} as const;
export type Persona = keyof typeof PERSONAS;

/** The teacher record everyone else tries to open. */
export const OWNER_TEACHER_ID = PERSONAS.owner.teacherId;

export async function personaRows() {
  const passwordHash = await bcrypt.hash(PERSONA_PASSWORD, 4);
  const user = (id: string, email: string, extra: Partial<typeof users.$inferInsert>): typeof users.$inferInsert => ({
    id, email, name: email.split('@')[0], passwordHash, role: 'USER', activated: true, createdAt: NOW, updatedAt: NOW, ...extra,
  });
  const role = (module: string) => `role-${module.toLowerCase()}`;
  const officeModules = [PERSONAS.hr, PERSONAS.finance, PERSONAS.analysis];
  return {
    authRoles: officeModules.map(p => ({ id: role(p.module), name: `${p.module} only`, createdAt: NOW, updatedAt: NOW })) as (typeof authRoles.$inferInsert)[],
    authRoleModules: officeModules.map(p => ({ id: `arm-${p.module}`, authRoleId: role(p.module), module: p.module, createdAt: NOW })) as (typeof authRoleModules.$inferInsert)[],
    positions: [{ positionId: 'P-PLAIN', name: 'Teacher (no access role)', authRoleId: null, createdAt: NOW, updatedAt: NOW }] as (typeof positions.$inferInsert)[],
    teachers: [
      { id: 't-tina', name: 'Tina Teacher', color: '#7c3aed', positionId: 'P-PLAIN', createdAt: NOW, updatedAt: NOW },
      // Olive's record carries personal and pay details, so a leak would show.
      { id: 't-olive', name: 'Olive Owner', color: '#2563eb', positionId: 'P-PLAIN', phone: '012-3456789', dob: new Date('1990-05-01'), isFixedSalary: true, fixedSalaryAmount: 4321, createdAt: NOW, updatedAt: NOW },
    ] as (typeof teachers.$inferInsert)[],
    users: [
      user(PERSONAS.teacher.id, PERSONAS.teacher.email, { teacherId: PERSONAS.teacher.teacherId }),
      user(PERSONAS.owner.id, PERSONAS.owner.email, { teacherId: PERSONAS.owner.teacherId }),
      ...officeModules.map(p => user(p.id, p.email, { authRoleId: role(p.module) })),
      user(PERSONAS.admin.id, PERSONAS.admin.email, { role: 'ADMIN' }),
    ],
  };
}
