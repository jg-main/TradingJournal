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
let _isSchedulerActive: boolean = false;
let _jobRunning: boolean = false;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Return the ISO timestamp of the next scheduled backup run, or null
 * when the scheduler is not active.
 *
 * Called by the GET /api/backup/status endpoint.
 */
/**
 * Return the ISO timestamp of the next scheduled backup run, or null
 * when the scheduler is not active.
 */
export function getNextScheduledAt(): string | null {
  if (!cronTask || cronTask.getStatus() === 'destroyed') return null;
  const next = cronTask.getNextRun();
  return next ? next.toISOString() : null;
}

/**
 * Return whether the scheduler is currently active (task exists and running).
 */
export function isSchedulerActive(): boolean {
  return _isSchedulerActive;
}

/**
 * Return the current cron status string: 'started', 'stopped', or 'destroyed'.
 */
export function getSchedulerStatus(): string {
  if (!cronTask) return 'stopped';
  return cronTask.getStatus();
}

/**
 * Convert a 24-hour time string (HH:MM) to a daily cron expression.
 *
 * Examples:
 *   '02:00' -> '0 2 * * *'
 *   '14:30' -> '30 14 * * *'
 *   '23:45' -> '45 23 * * *'
 */
export function cronTimeToExpression(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[scheduler] Invalid cron time "${time}", falling back to 02:00`);
    return '0 2 * * *';
  }
  return `${minute} ${hour} * * *`;
}

/**
 * Convert a 24-hour backup time (HH:MM) expressed in the given IANA timezone
 * into a UTC cron expression that node-cron can use when the system clock is UTC.
 *
 * This allows Docker containers to remain on UTC while the user configures
 * backup times in their local timezone via app settings.
 *
 * Uses Intl.DateTimeFormat for DST-aware offset computation.
 *
 * Example: '21:00' in 'America/Bogota' (UTC-5) → '0 2 * * *'
 */
export function cronTimeToUTCExpression(time: string, timezone: string): string {
  const [hour, minute] = time.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[scheduler] Invalid cron time "${time}", falling back to 02:00`);
    return '0 2 * * *';
  }

  try {
    // Get the timezone offset to compute UTC from local time.
    // We create a reference point (today at noon UTC) and ask the target timezone
    // for its offset at that moment.
    const noon = new Date();
    noon.setUTCHours(12, 0, 0, 0);

    const offsetFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
      hour12: false,
    });
    const offsetStr = offsetFmt.formatToParts(noon)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT';

    // Parse "GMT-05:00" or "GMT+05:30"
    const match = offsetStr.match(/GMT([+-])(\d+):?(\d+)?/);
    if (!match) throw new Error(`Unparseable offset: ${offsetStr}`);

    const sign = match[1] === '-' ? -1 : 1;
    const offsetHours = Number(match[2]);
    const offsetMins = Number(match[3] || 0);
    const totalOffsetHours = sign * (offsetHours + offsetMins / 60);

    // Convert local time to UTC: UTC = local - offset (offset is negative west of UTC)
    // Bogota (UTC-5): 21:00 local → 21 - (-5) = 26 → 02:00 UTC
    // Tokyo (UTC+9):  21:00 local → 21 - 9 = 12:00 UTC
    const utcTotalMinutes = (hour * 60 + minute) - (totalOffsetHours * 60);
    // Normalize into 0–1439 range (24h)
    const normalized = ((utcTotalMinutes % 1440) + 1440) % 1440;

    const utcHour = Math.floor(normalized / 60);
    const utcMinute = Math.floor(normalized % 60);

    console.log(
      `[scheduler] TZ conversion: "${time}" ${timezone} (${offsetStr}) → ${String(utcHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')} UTC → cron "${utcMinute} ${utcHour} * * *"`,
    );
    return `${utcMinute} ${utcHour} * * *`;
  } catch (err) {
    console.warn(
      `[scheduler] Failed to convert timezone "${timezone}", falling back to server-local cron`,
      err instanceof Error ? err.message : String(err),
    );
    return cronTimeToExpression(time);
  }
}

/**
 * Return the current cron expression, or empty string if not set.
 */
export function getCurrentCronExpression(): string {
  return currentCronExpression;
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
 * A mutex (_jobRunning) prevents concurrent backup executions — node-cron
 * can double-fire on exact-minute boundaries.
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
  _isSchedulerActive = true;

  // Create the recurring cron job (starts in idle state)
  cronTask = cron.schedule(cronExpression, async () => {
    if (_jobRunning) {
      console.log('[scheduler] Backup already running — skipping duplicate cron fire');
      return;
    }
    _jobRunning = true;
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
    } finally {
      _jobRunning = false;
    }
  });

  // Activate the cron task
  cronTask.start();

  console.log(
    `[scheduler] Cron job scheduled with expression: "${cronExpression}"`,
    `| next run at: ${getNextScheduledAt()}`,
  );

  // Schedule an immediate first backup after a 10-second readiness delay,
  // but only if the next cron run is more than 60 seconds away to prevent
  // a double-fire when the scheduler starts/restarts near the cron schedule.
  const nextCronAt = cronTask.getNextRun();
  const secondsUntilNextCron = nextCronAt
    ? ((nextCronAt.getTime() - Date.now()) / 1000)
    : Infinity;

  if (secondsUntilNextCron > 60) {
    console.log('[scheduler] Scheduling immediate first backup in 10s readiness delay');
    immediateTimeout = setTimeout(async () => {
      if (_jobRunning) {
        console.log('[scheduler] Backup already running — skipping immediate backup');
        return;
      }
      _jobRunning = true;
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
      } finally {
        _jobRunning = false;
      }
    }, 10_000);
  } else {
    console.log(
      `[scheduler] Skipping immediate backup — next cron run in ${Math.round(secondsUntilNextCron)}s`,
    );
  }
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
  _isSchedulerActive = false;
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
