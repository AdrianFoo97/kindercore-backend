import { z } from 'zod';

/**
 * Signing in only needs something typed in each box. Rules about what a
 * password must look like belong to *setting* one (activate / reset) — here a
 * too-short or oddly-shaped entry is simply a wrong email or password (401),
 * never an error.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email'),
  password: z.string().min(1, 'Enter your password'),
});
