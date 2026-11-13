import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { noStoreApi } from './middlewares/noStore.middleware.js';
import { requireAppRequest } from './middlewares/csrf.middleware.js';
import { authMiddleware, requireModule } from './middlewares/auth.middleware.js';
import { MODULES } from './constants/authModules.js';
import { sessionToken } from './services/session.service.js';
import { sseClients } from './sse.js';
import { UPLOAD_ROOT } from './routes/upload.routes.js';
import { router } from './routes/index.js';

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
  // 10 MB is the ceiling for the candidate-import endpoint (up to 500
  // rows × text fields ≈ a few MB of JSON). Regular API traffic is
  // nowhere near this — the limit is generous so imports don't fail
  // with "request entity too large" and require a redeploy to unblock.
  app.use(express.json({ limit: '10mb' }));

  // ── Rate limiting ──
  if (limitLogins) {
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 login attempts per 15 min per IP
      message: { message: 'Too many login attempts. Please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use('/api/auth/login', authLimiter);
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
    if (req.method === 'POST' && req.path === '/' && !sessionToken(req)) return leadCreateLimiter(req, _res, next);
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
    if (sessionToken(req)) return next();                    // signed-in staff: skip
    if (req.method === 'GET' && req.path === '/form-options') return next();
    if (req.method === 'POST') return candidatePublicLimiter(req, _res, next);
    next();
  });

  // Public "New staff" form — a handful of joiners a month, so a tight cap.
  const staffJoinLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/staff-joins', (req, _res, next) => {
    if (req.method === 'POST' && req.path === '/' && !sessionToken(req)) return staffJoinLimiter(req, _res, next);
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

    // Log full stack for 500 errors
    console.log(`[ERROR] ${timestamp} INTERNAL_ERROR | ${method} ${originalUrl} | IP: ${ip}`);
    console.log(err.stack ?? err.message);

    res.status(500).json({ message: isProd ? 'Something went wrong. Please try again.' : err.message, code: 'INTERNAL_ERROR' });
  });

  return app;
}
