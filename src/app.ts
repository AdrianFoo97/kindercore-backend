import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { noStoreApi } from './middlewares/noStore.middleware.js';
import { requireAppRequest } from './middlewares/csrf.middleware.js';
import { authMiddleware, requireModule } from './middlewares/auth.middleware.js';
import { MODULES } from './constants/authModules.js';
import { hasValidSession } from './services/session.service.js';
import { sseClients } from './sse.js';
import { UPLOAD_ROOT } from './routes/upload.routes.js';
import { router } from './routes/index.js';
import { smallJsonBody } from './middlewares/bodyLimit.middleware.js';

// The Express app — every security header, limit, guard and route, in the
// order they run. Built here (not in server.ts, which runs migrations and
// listens) so the access-control tests can exercise exactly the production
// chain over real HTTP (see tests/integration/security.http*.test.ts).

export interface AppOptions {
  /** Log every request to the console (off in tests — hundreds of requests). */
  logRequests?: boolean;
  /** Rate-limit sign-in attempts (off in tests, which sign many people in). */
  limitLogins?: boolean;
}

/** Login limits: per IP, and per account (wrong passwords only). */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_LOGINS_PER_ACCOUNT = 10;
/** Promo-code checks per IP per window — plenty for a parent, too few to guess codes. */
const PROMO_CHECK_WINDOW_MS = 15 * 60 * 1000;
const PROMO_CHECKS_PER_WINDOW = 30;

export function createApp({ logRequests = true, limitLogins = true }: AppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const isProd = process.env.NODE_ENV === 'production';

  // ── Security headers ──
  app.use(helmet());

  // ── CORS ──
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const allowedOrigins = [frontendUrl];
  if (frontendUrl.includes('://') && !frontendUrl.includes('localhost')) {
    const url = new URL(frontendUrl);
    if (url.hostname.startsWith('www.')) {
      allowedOrigins.push(frontendUrl.replace('://www.', '://'));
    } else {
      allowedOrigins.push(frontendUrl.replace('://', '://www.'));
    }
  }
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );

  // ── Body size limit ──
  // Small for everyone; the candidate import gets its large allowance in its
  // own route, after sign-in + admin (bodyLimit.middleware).
  app.use(smallJsonBody);

  // ── Rate limiting ──
  if (limitLogins) {
    const authLimiter = rateLimit({
      windowMs: LOGIN_WINDOW_MS, // 15 minutes
      max: 10, // 10 login attempts per 15 min per IP
      message: { message: 'Too many login attempts. Please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    });
    // Per ACCOUNT too: bots rotate IP addresses (or fake them in X-Forwarded-For),
    // so the per-IP limit alone can't stop guessing one person's password.
    // Only failed attempts count, so the real person signing in isn't affected.
    const accountLimiter = rateLimit({
      windowMs: LOGIN_WINDOW_MS,
      limit: FAILED_LOGINS_PER_ACCOUNT,
      keyGenerator: req => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`,
      skipSuccessfulRequests: true,
      message: { message: 'Too many wrong passwords for this account. Please try again in 15 minutes.' },
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use('/api/auth/login', authLimiter, accountLimiter);
  }

  const leadCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 enquiries per hour per IP
    message: { message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/leads', (req, _res, next) => {
    // Only rate-limit unauthenticated POST (public enquiry form); skip for logged-in users (imports)
    if (req.method === 'POST' && req.path === '/' && !hasValidSession(req)) return leadCreateLimiter(req, _res, next);
    next();
  });

  // Public-form candidate intake + resume upload. Both routes are unauth so
  // they must be rate-limited; the form-options GET is read-only and cheap so
  // we skip it. Body parsing for /resume happens via multer (multipart) so
  // the global express.json() doesn't touch it.
  const candidatePublicLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: { message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/candidates', (req, _res, next) => {
    if (hasValidSession(req)) return next();                 // signed-in staff: skip
    if (req.method === 'GET' && req.path === '/form-options') return next();
    if (req.method === 'POST') return candidatePublicLimiter(req, _res, next);
    next();
  });

  // Public promo-code check on the enquiry form — a person checks one code;
  // a bot guessing codes checks hundreds.
  const promoCheckLimiter = rateLimit({
    windowMs: PROMO_CHECK_WINDOW_MS,
    limit: PROMO_CHECKS_PER_WINDOW,
    message: { message: 'Too many tries. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/marketing-campaigns/check', promoCheckLimiter);

  // Public "New staff" form — a handful of joiners a month, so a tight cap.
  const staffJoinLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/staff-joins', (req, _res, next) => {
    if (req.method === 'POST' && req.path === '/' && !hasValidSession(req)) return staffJoinLimiter(req, _res, next);
    next();
  });

  // ── Request logging ──
  if (logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      const { method, originalUrl } = req;

      res.on('finish', () => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        if (status >= 500) {
          console.log(`[ERROR] ${method} ${originalUrl} ${status} ${ms}ms`);
        } else if (status >= 400) {
          console.log(`[WARNING] ${method} ${originalUrl} ${status} ${ms}ms`);
        } else {
          console.log(`${method} ${originalUrl} ${status} ${ms}ms`);
        }
      });

      next();
    });
  }

  // ── SSE: real-time event stream ──
  // Live "new lead" pings for the Leads page — signed-in Marketing staff only
  // (the browser sends the session cookie with EventSource's withCredentials).
  app.get('/api/events', authMiddleware, requireModule(MODULES.MARKETING), (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':\n\n'); // heartbeat
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // ── Static: uploaded files (badge images, etc.) ──
  // Override helmet's default `same-origin` CORP so the SPA on a different
  // origin (e.g. localhost:5173) can load these images via <img>.
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(UPLOAD_ROOT, { maxAge: '7d', fallthrough: false }),
  );

  // ── Never let a browser or proxy keep API data ──
  // Pay, finance and personal records must not sit in a shared computer's
  // disk cache or a proxy. A handler may still opt in for its own files
  // (e.g. a receipt image sets "private, max-age=…" after this).
  app.use('/api', noStoreApi);
  // Changing requests made with the session cookie must come from the app itself.
  app.use('/api', requireAppRequest);

  // ── Routes ──
  app.use('/api', router);

  // ── Global error handler ──
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const timestamp = new Date().toISOString();
    const { method, originalUrl, ip } = req;

    // Detect database connection errors
    const isDbError = /ECONNREFUSED|ETIMEDOUT|ER_ACCESS_DENIED|PROTOCOL_CONNECTION_LOST|ER_BAD_DB_ERROR|ENOTFOUND|connect ECONN/i.test(err.message);

    if (isDbError) {
      console.log(`[ERROR] ${timestamp} DB_UNAVAILABLE | ${method} ${originalUrl} | IP: ${ip} | ${err.message}`);
      res.status(503).json({ message: 'Service temporarily unavailable. Please try again shortly.', code: 'DB_UNAVAILABLE' });
      return;
    }

    // A deliberate 4xx from a library (e.g. express.static: the uploaded file
    // isn't there) is the caller's problem, not a server crash — answer it as such.
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ message: status === 404 ? 'Not found' : 'Bad request', code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST' });
      return;
    }

    // Log full stack for 500 errors
    console.log(`[ERROR] ${timestamp} INTERNAL_ERROR | ${method} ${originalUrl} | IP: ${ip}`);
    console.log(err.stack ?? err.message);

    res.status(500).json({ message: isProd ? 'Something went wrong. Please try again.' : err.message, code: 'INTERNAL_ERROR' });
  });

  return app;
}
