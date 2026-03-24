// Startup wrapper - catches module-level crashes that would otherwise produce no logs
console.info('[startup] process started, Node version:', process.version);

process.on('uncaughtException', (err: Error) => {
  console.error('[startup] UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[startup] UNHANDLED REJECTION:', reason);
  process.exit(1);
});

import('./server.js').catch((err: Error) => {
  console.error('[startup] FAILED TO LOAD server.js:', err.message);
  console.error(err.stack);
  process.exit(1);
});
