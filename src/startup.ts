// Startup wrapper - catches module-level crashes that would otherwise produce no logs
console.log('[startup] process started, Node version:', process.version);

process.on('uncaughtException', (err: Error) => {
  console.log('[startup] UNCAUGHT EXCEPTION:', err.message);
  console.log(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.log('[startup] UNHANDLED REJECTION:', reason);
  process.exit(1);
});

import('./server.js').catch((err: Error) => {
  console.log('[startup] FAILED TO LOAD server.js:', err.message);
  console.log(err.stack);
  process.exit(1);
});
