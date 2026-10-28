import bcrypt from 'bcryptjs';
import { users } from '../../db/schema.js';

// Test accounts for the login / activation tests, typed against the real
// `User` table. Passwords are hashed with bcrypt exactly as the app stores
// them, so login runs its real compare against a real stored hash.

export const PASSWORD = 'Correct-Horse-9';
const NOW = new Date('2026-01-01T00:00:00Z');

type UserRow = typeof users.$inferInsert;

/** An activated account that can log in with PASSWORD. */
export async function activeUser(overrides: Partial<UserRow> = {}): Promise<UserRow> {
  return {
    id: 'user-admin',
    email: 'admin@kindertech.test',
    name: 'Ada Admin',
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    role: 'ADMIN',
    activated: true,
    teacherId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** An invited account that hasn't set a password yet (as createInvite makes it). */
export function pendingInvite(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-pending',
    email: 'new.teacher@kindertech.test',
    name: '',
    passwordHash: '',
    role: 'USER',
    activated: false,
    inviteToken: 'invite-token-123',
    inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
