// Startup wrapper - catches module-level crashes that would otherwise produce no logs
console.log('[startup] process started, Node version:', process.version);
process.on('uncaughtException', (err) => {
    console.error('[startup] UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[startup] UNHANDLED REJECTION:', reason);
    process.exit(1);
});
import('./server.js').catch((err) => {
    console.error('[startup] FAILED TO LOAD server.js:', err.message);
    console.error(err.stack);
    process.exit(1);
});
export {};
//# sourceMappingURL=startup.js.map