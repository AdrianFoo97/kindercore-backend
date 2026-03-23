import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes } from 'crypto';
import { eq, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { loginSchema } from '../validators/auth.validator.js';

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' },
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}

// ── Create invite ─────────────────────────────────────────────────────────
export async function createInvite(req: Request, res: Response): Promise<void> {
  const { email, role } = req.body as { email: string; role?: 'ADMIN' | 'STAFF' };
  if (!email?.trim()) { res.status(400).json({ message: 'Email is required' }); return; }

  // Check if user already exists and is activated
  const [existing] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (existing?.activated) { res.status(409).json({ message: 'User already exists and is active' }); return; }

  const inviteToken = randomBytes(32).toString('hex');
  const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const now = new Date();

  if (existing) {
    // Update existing pending invite
    await db.update(users).set({ inviteToken, inviteExpiresAt, role: role ?? 'STAFF', updatedAt: now }).where(eq(users.id, existing.id));
  } else {
    // Create new pending user
    await db.insert(users).values({
      id: randomUUID(),
      email: email.trim().toLowerCase(),
      name: '',
      passwordHash: '',
      role: role ?? 'STAFF',
      inviteToken,
      inviteExpiresAt,
      activated: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const inviteLink = `${frontendUrl}/setup?token=${inviteToken}`;

  // Send invite email (non-blocking — don't fail if email fails)
  const { sendInviteEmail } = await import('../utils/email.js');
  const emailSent = await sendInviteEmail(email.trim().toLowerCase(), inviteLink, role ?? 'STAFF');

  res.json({ inviteLink, expiresAt: inviteExpiresAt, emailSent });
}

// ── Verify invite token ───────────────────────────────────────────────────
export async function verifyInvite(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  const [user] = await db.select().from(users).where(eq(users.inviteToken, token)).limit(1);

  if (!user) { res.status(404).json({ message: 'Invalid invite link' }); return; }
  if (user.activated) { res.status(410).json({ message: 'This invite has already been used' }); return; }
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
    res.status(410).json({ message: 'This invite link has expired' });
    return;
  }

  res.json({ email: user.email, role: user.role });
}

// ── Activate account ──────────────────────────────────────────────────────
export async function activateAccount(req: Request, res: Response): Promise<void> {
  const { token, name, password } = req.body as { token: string; name: string; password: string };

  if (!token || !name?.trim() || !password) {
    res.status(400).json({ message: 'All fields are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ message: 'Password must be at least 8 characters' });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.inviteToken, token)).limit(1);
  if (!user) { res.status(404).json({ message: 'Invalid invite link' }); return; }
  if (user.activated) { res.status(410).json({ message: 'This invite has already been used' }); return; }
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
    res.status(410).json({ message: 'This invite link has expired' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  await db.update(users).set({
    name: name.trim(),
    passwordHash,
    activated: true,
    inviteToken: null,
    inviteExpiresAt: null,
    updatedAt: now,
  }).where(eq(users.id, user.id));

  // Auto-login after activation
  const jwtToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' },
  );

  res.json({
    token: jwtToken,
    user: { id: user.id, email: user.email, name: name.trim(), role: user.role },
  });
}

// ── List users ────────────────────────────────────────────────────────────
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    activated: users.activated,
    inviteToken: users.inviteToken,
    createdAt: users.createdAt,
  }).from(users);
  const result = allUsers.map(({ inviteToken, ...rest }) => ({
    ...rest,
    inviteLink: inviteToken ? `${frontendUrl}/setup?token=${inviteToken}` : null,
  }));
  res.json(result);
}

// ── Delete user ───────────────────────────────────────────────────────────
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (id === req.user!.id) { res.status(400).json({ message: 'Cannot delete your own account' }); return; }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) { res.status(404).json({ message: 'User not found' }); return; }

  // ADMIN can only delete STAFF
  if (req.user!.role === 'ADMIN' && target.role !== 'STAFF') {
    res.status(403).json({ message: 'Admins can only remove staff members' }); return;
  }
  // STAFF cannot delete anyone
  if (req.user!.role === 'STAFF') {
    res.status(403).json({ message: 'Insufficient permissions' }); return;
  }

  await db.delete(users).where(eq(users.id, id));
  res.json({ success: true });
}
