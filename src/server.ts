import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { router } from './routes/index.js';
import { pool } from './db/client.js';

// ── Auto-migrate: add columns that may be missing ────────────────────────────
async function runMigrations() {
  const migrations = [
    `ALTER TABLE \`Teacher\` ADD COLUMN \`overrideProfitShareWeight\` TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE \`Teacher\` ADD COLUMN \`customProfitShareWeight\` FLOAT NULL`,
    `ALTER TABLE \`OperatingCostCategoryGroup\` ADD COLUMN \`isProtected\` TINYINT(1) NOT NULL DEFAULT 0`,
  ];
  const conn = await pool.getConnection();
  try {
    for (const sql of migrations) {
      try {
        await conn.execute(sql);
        const col = sql.match(/ADD COLUMN `(\w+)`/)?.[1];
        if (col) console.log(`[migrate] Added column: ${col}`);
      } catch (e: any) {
        if (e.code !== 'ER_DUP_FIELDNAME') throw e;
        // Column already exists — skip silently
      }
    }
  } finally {
    conn.release();
  }
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ?? 4000;
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
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 min per IP
  message: { message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

const leadCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 enquiries per hour per IP
  message: { message: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/leads', (req, _res, next) => {
  // Only rate-limit unauthenticated POST (public enquiry form); skip for logged-in users (imports)
  if (req.method === 'POST' && req.path === '/' && !req.headers.authorization) return leadCreateLimiter(req, _res, next);
  next();
});

// ── Request logging ──
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

// ── SSE: real-time event stream ──
import { sseClients } from './sse.js';

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n'); // heartbeat
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

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

runMigrations()
  .then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[backend] Server running on http://localhost:${PORT}`);
      const dbUrl = process.env.DATABASE_URL ?? '(not set)';
      const masked = dbUrl.replace(/:([^:@]+)@/, ':****@');
      console.log(`[backend] DATABASE_URL: ${masked}`);
    });
  })
  .catch(err => {
    console.error('[migrate] Failed to run migrations:', err.message);
    process.exit(1);
  });
