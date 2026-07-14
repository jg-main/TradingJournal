/**
 * instrumentation.ts
 *
 * Next.js instrumentation hook that wires up the scheduled backup job at
 * server startup.
 *
 * The `register()` function runs once during server initialization in the
 * Node.js runtime. The actual work is delegated to
 * src/lib/start-backup-scheduler.ts via dynamic import, so Turbopack does
 * not trace Node.js native module imports (node:fs, node:path, node:crypto,
 * node:stream) or process.on during the Edge Runtime module analysis phase.
 *
 * Next.js App Router convention: `src/instrumentation.ts` with a named
 * `register` export is automatically invoked on server start.
 *
 * Pattern: Next.js instrumentation hook, src/lib/start-backup-scheduler.ts
 */

/**
 * Server initialization hook — called automatically by Next.js once during
 * server boot, before the first request is accepted.
 *
 * Delegates all Node.js-specific work (process.on, DB access, scheduler
 * startup) to a dynamically imported bootstrap module so Turbopack does
 * not flag Edge Runtime-incompatible APIs during module analysis.
 *
 * Does not block server startup on failure — errors are logged and swallowed.
 */
export async function register(): Promise<void> {
  // The scheduler is production infrastructure. Skipping it in dev keeps the
  // webpack development compiler from tracing its native SQLite dependency.
  if (process.env.NODE_ENV === 'development') return;

  // Next.js instrumentation runs in both nodejs and edge runtimes;
  // the scheduler and DB access are nodejs-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const mod = await import('./instrumentation-node');
    mod.registerNodeInstrumentation();
  } catch (err) {
    console.error(
      '[instrumentation] Failed to start backup scheduler:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
