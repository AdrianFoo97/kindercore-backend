import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { router } from './routes/index.js';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());
app.use('/api', router);

// Global error handler — keeps the server alive on unhandled route errors
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ message: err.message ?? 'Internal server error' });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`[backend] Server running on http://localhost:${PORT}`);
});
