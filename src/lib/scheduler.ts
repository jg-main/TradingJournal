/**
 * scheduler.ts
 *
 * Scheduled backup job manager using node-cron.
 *
 * Manages a single cron job instance that runs backups on a configurable
 * schedule. On start, also fires an immediate first backup after a 10-second
 * readiness delay to allow database migrations and app init to complete.
 *
 * Production-only: active only when NODE_ENV === 'production'.
 * In all other environments (development, test), startScheduler is a no-op.
 *
 * Exposes getNextScheduledAt() for the GET /api/backup/status endpoint.
 *
 * Uses structured console.log for backup lifecycle events so the app-level
 * logger is not required — making this module self-contained and testable.
 */

import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';

// ── State ───────────────────────────────────────────────────────────────

let cronTask: ScheduledTask | null = null;
let immediateTimeout: ReturnType<typeof setTimeout> | null = null;
let currentCronExpression: string = '';

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Return the ISO timestamp of the next scheduled backup run, or null
 * when the scheduler is not active.
 *
 * Called by the GET /api/backup/status endpoint.
 */
export function getNextScheduledAt(): string | null {
  if (!cronTask || cronTask.getStatus() === 'destroyed') return null;
  const next = cronTask.getNextRun();
  return next ? next.toISOString() : null;
}

/**
 * Start the cron scheduler with the given cron expression and job function.
 *
 * This is a no-op when NODE_ENV is not 'production' — the scheduler logs
 * a message and returns early.
 *
 * On start:
 * 1. Schedules the recurring cron job
 * 2. Calls task.start() to activate it
 * 3. Schedules an immediate first backup after a 10-second readiness delay
 *    (setTimeout) to allow database migrations to complete before the first
 *    backup attempt
 *
 * If a scheduler is already running, it is stopped first before the new one
 * is created.
 *
 * @param cronExpression - Standard cron expression (e.g. '0 2 * * *' for 2 AM daily)
 * @param job - A function that performs the backup work
 */
export function startScheduler(
  cronExpression: string,
  job: () => Promise<void>,
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[scheduler] NODE_ENV is not "production" — scheduler disabled');
    return;
  }

  if (cronTask) {
    console.log('[scheduler] Cron task already running — stopping first');
    stopScheduler();
  }

  currentCronExpression = cronExpression;

  // Create the recurring cron job (starts in idle state)
  cronTask = cron.schedule(cronExpression, async () => {
    const timestamp = new Date().toISOString();
    console.log(`[scheduler] Backup triggered by cron schedule at ${timestamp}`);
    try {
      await job();
      console.log(`[scheduler] Backup completed successfully at ${timestamp}`);
    } catch (error) {
      console.error(
        `[scheduler] Backup failed at ${timestamp}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  // Activate the cron task
  cronTask.start();

  console.log(
    `[scheduler] Cron job scheduled with expression: "${cronExpression}"`,
    `| next run at: ${getNextScheduledAt()}`,
  );

  // Schedule an immediate first backup after a 10-second readiness delay
  console.log('[scheduler] Scheduling immediate first backup in 10s readiness delay');
  immediateTimeout = setTimeout(async () => {
    const timestamp = new Date().toISOString();
    console.log(`[scheduler] Immediate first backup triggered at ${timestamp}`);
    try {
      await job();
      console.log(
        `[scheduler] Immediate first backup completed successfully at ${timestamp}`,
      );
    } catch (error) {
      console.error(
        `[scheduler] Immediate first backup failed at ${timestamp}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }, 10_000);
}

/**
 * Stop the currently running cron job and cancel any pending immediate
 * backup.
 *
 * Safe to call when no scheduler is running — it is a no-op.
 */
export function stopScheduler(): void {
  if (immediateTimeout) {
    clearTimeout(immediateTimeout);
    immediateTimeout = null;
  }

  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[scheduler] Cron job stopped');
  }

  currentCronExpression = '';
}

/**
 * Reschedule the cron job with a new cron expression and job function.
 *
 * Stops the current scheduler (if running) and starts a new one with the
 * given expression. This allows settings-driven runtime reconfiguration:
 * when the user changes the backup schedule, call reschedule().
 *
 * @param cronExpression - New cron expression
 * @param job - Job function (forwarded to startScheduler)
 */
export function reschedule(
  cronExpression: string,
  job: () => Promise<void>,
): void {
  console.log(
    `[scheduler] Rescheduling from "${currentCronExpression}" to "${cronExpression}"`,
  );
  startScheduler(cronExpression, job);
}
