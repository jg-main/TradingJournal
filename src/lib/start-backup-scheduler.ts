/**
 * start-backup-scheduler.ts
 *
 * Bootstrap module for starting the backup scheduler from instrumentation.ts.
 *
 * Separated from instrumentation.ts so Turbopack doesn't trace Node.js native
 * module imports (node:fs, node:path, node:crypto, node:stream) during Edge
 * Runtime module analysis. instrumentation.ts imports this file with a static
 * import path because this module has no top-level Node.js native module
 * imports — all of them are inside async function bodies.
 *
 * Also handles graceful shutdown (SIGTERM/SIGINT) via process.on so those
 * calls don't appear in instrumentation.ts where Turbopack would flag them
 * as Edge Runtime-incompatible.
 *
 * Pattern: src/instrumentation.ts
 */

export function registerSignalHandlers(): void {
  // Graceful shutdown: stop the scheduler on SIGTERM/SIGINT
  process.on('SIGTERM', async () => {
    console.log('[instrumentation] Received SIGTERM — stopping scheduler');
    const { stopScheduler } = await import('./scheduler');
    stopScheduler();
  });

  process.on('SIGINT', async () => {
    console.log('[instrumentation] Received SIGINT — stopping scheduler');
    const { stopScheduler } = await import('./scheduler');
    stopScheduler();
  });
}

export async function startSchedulerIfEnabled(): Promise<void> {
  try {
    const { db } = await import('@/db/index');
    const { settings, appProfile } = await import('@/db/schema');

    const [settingsRow, profileRow] = await Promise.all([
      Promise.resolve(db.select().from(settings).limit(1).get()),
      Promise.resolve(db.select().from(appProfile).limit(1).get()),
    ]);

    const backupEnabled = settingsRow?.backupEnabled ?? false;

    if (backupEnabled) {
      const backupCronTime = settingsRow?.backupCronTime ?? '02:00';
      const timezone = profileRow?.timezone ?? 'America/Bogota';
      const { startScheduler, cronTimeToUTCExpression } = await import('./scheduler');
      const { runBackupJob } = await import('./backup-job');
      const cronExpression = cronTimeToUTCExpression(backupCronTime, timezone);
      console.log(
        `[instrumentation] Backups enabled (${backupCronTime} ${timezone}) — starting scheduler...`,
      );
      startScheduler(cronExpression, runBackupJob);
    } else {
      console.log(
        '[instrumentation] Backups are not enabled in settings — scheduler not started',
      );
    }
  } catch (err) {
    console.error(
      '[instrumentation] Could not read settings for scheduler startup:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
