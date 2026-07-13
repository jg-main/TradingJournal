/**
 * instrumentation.ts
 *
 * Next.js instrumentation hook that wires up the scheduled backup job at
 * server startup.
 *
 * The `register()` function runs once during server initialization in the
 * Node.js runtime. It checks whether backups are enabled in the settings
 * table (so the scheduler respects the user's preference), and if so,
 * starts the scheduler with the default daily cron expression.
 *
 * Guarded by try/catch so any scheduler failure does not block server
 * startup. Registers SIGTERM/SIGINT handlers for graceful shutdown.
 *
 * Uses dynamic imports for scheduler and backup-job dependencies to avoid
 * Turbopack eagerly resolving native modules (node-cron, archiver,
 * better-sqlite3) for the client bundle.
 *
 * Next.js App Router convention: `src/instrumentation.ts` with a named
 * `register` export is automatically invoked on server start.
 *
 * Pattern: Next.js instrumentation hook, src/lib/scheduler.ts,
 * src/lib/backup-job.ts
 */

/** Default daily cron: 2:00 AM server-local time */
const DEFAULT_CRON_EXPRESSION = '0 2 * * *';

/**
 * Server initialization hook — called automatically by Next.js once during
 * server boot, before the first request is accepted.
 *
 * - Checks if backups are enabled in the settings table
 * - If yes, starts the cron scheduler
 * - Registers graceful shutdown handlers for SIGTERM and SIGINT
 *
 * Does not block server startup on failure — errors are logged and swallowed.
 */
export function register(): void {
  // Next.js instrumentation runs in both nodejs and edge runtimes;
  // the scheduler and DB access are nodejs-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Graceful shutdown: stop the scheduler on SIGTERM/SIGINT
  // Dynamic import avoids Turbopack resolving native modules for the client
  process.on('SIGTERM', async () => {
    console.log('[instrumentation] Received SIGTERM — stopping scheduler');
    const { stopScheduler } = await import('./lib/scheduler');
    stopScheduler();
  });

  process.on('SIGINT', async () => {
    console.log('[instrumentation] Received SIGINT — stopping scheduler');
    const { stopScheduler } = await import('./lib/scheduler');
    stopScheduler();
  });

  // Check if backups are enabled in settings before starting the scheduler.
  // The scheduler itself has a NODE_ENV === 'production' guard, so this
  // is harmless in dev — we gate on settings too so the instrumentation
  // signal is accurate.
  startSchedulerIfEnabled(DEFAULT_CRON_EXPRESSION).catch((err) => {
    console.error(
      '[instrumentation] Failed to start backup scheduler:',
      err instanceof Error ? err.message : String(err),
    );
  });
}

/**
 * Read the settings table and start the scheduler if backups are enabled.
 *
 * Separated from `register()` so the async import does not make `register()`
 * return a Promise — Next.js calls it synchronously and the catch is handled.
 */
async function startSchedulerIfEnabled(cronExpression: string): Promise<void> {
  try {
    const { db } = await import('@/db/index');
    const { settings } = await import('@/db/schema');

    const row = db.select().from(settings).limit(1).get();
    const backupEnabled = row?.backupEnabled ?? false;

    if (backupEnabled) {
      console.log(
        '[instrumentation] Backups are enabled in settings — starting scheduler...',
      );
      const { startScheduler } = await import('./lib/scheduler');
      const { runBackupJob } = await import('./lib/backup-job');
      startScheduler(cronExpression, runBackupJob);
    } else {
      console.log(
        '[instrumentation] Backups are not enabled in settings — scheduler not started',
      );
    }
  } catch (err) {
    // Log but do not re-throw — instrumentation failure should never
    // block server startup
    console.error(
      '[instrumentation] Could not read settings for scheduler startup:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
