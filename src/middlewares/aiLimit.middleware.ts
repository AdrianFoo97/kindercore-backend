import rateLimit from 'express-rate-limit';

// AI requests cost real money. Without a limit, one account (or a stolen
// session) could run up the provider bill by sending the same PDF over and
// over. Counted per signed-in person — changing IP doesn't help — and only
// used after authMiddleware. Generous for real imports.

export const AI_REQUESTS_PER_WINDOW = 10;
export const AI_WINDOW_MS = 10 * 60 * 1000;

export const aiRequestLimit = rateLimit({
  windowMs: AI_WINDOW_MS,
  limit: AI_REQUESTS_PER_WINDOW,
  keyGenerator: req => `user:${req.user?.id ?? 'unknown'}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many AI readings in a short time. Wait a few minutes and try again.', code: 'AI_RATE_LIMITED' },
});
