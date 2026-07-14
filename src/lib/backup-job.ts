/**
 * backup-job.ts
 *
 * Automated backup job that reads settings, creates a backup ZIP via
 * createBackupBuffer(), writes it to the backup directory, updates
 * settings with run status, and performs retention cleanup.
 *
 * This module is the shared entry point for both:
 * 1. The scheduled cron job (called by scheduler.ts each cron tick)
 * 2. Immediate first backup on startup (called by scheduler.ts after 10s delay)
 *
 * The backup directory is derived from the database file path:
 *   DB at `./.trading-journal/journal.db` → backups at `./.trading-journal/backups/`
 *
 * Pattern: src/lib/create-backup.ts (same dynamic DB import pattern)
 */

import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '@/db/schema';
import { eq } from 'drizzle-orm';
import { mkdirSync, readdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createBackupBuffer } from './create-backup';

// ── Backup directory resolution ─────────────────────────────────────────

/**
 * Derive the backup storage directory from environment or database path.
 *
 * Priority:
 * 1. TJ_BACKUP_DIR environment variable (e.g. /mnt/backups/journal)
 * 2. Derived from DB_FILE_NAME: dirname(DB_FILE_NAME)/backups
 */
export function getBackupDir(): string {
  if (process.env.TJ_BACKUP_DIR) return process.env.TJ_BACKUP_DIR;
  const dbFile = process.env.DB_FILE_NAME || './.trading-journal/journal.db';
  const dbDir = dirname(dbFile);
  return join(dbDir, 'backups');
}

// ── Retention cleanup ───────────────────────────────────────────────────

/**
 * Remove the oldest backup files when the count exceeds retentionCount.
 *
 * Files are expected to be named `backup-<ISO_TIMESTAMP>.zip`. Since ISO
 * timestamps sort lexicographically, a simple `.sort()` orders them from
 * oldest to newest.
 *
 * @param backupDir - Directory containing backup ZIP files
 * @param retentionCount - Maximum number of backup files to keep (must be >= 0)
 */
export function performRetentionCleanup(backupDir: string, retentionCount: number): void {
  if (!existsSync(backupDir)) return;

  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .sort(); // ISO timestamps sort lexicographically by date

  if (files.length <= retentionCount) return;

  const toDelete = files.slice(0, files.length - retentionCount);
  for (const file of toDelete) {
    const filePath = join(backupDir, file);
    try {
      unlinkSync(filePath);
      console.log(`[backup] Retention: deleted oldest backup "${file}"`);
    } catch (err) {
      console.error(
        `[backup] Retention: failed to delete "${file}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// ── Main backup job ─────────────────────────────────────────────────────

/**
 * Run one full backup cycle:
 *
 * 1. Read settings from DB (retention count, row ID for status update)
 * 2. Create the backup ZIP buffer via createBackupBuffer()
 * 3. Ensure the backup directory exists (mkdir recursive)
 * 4. Write the ZIP as `backup-{ISO_TIMESTAMP}.zip`
 * 5. Update `settings.backupLastRunAt` and `settings.backupLastRunStatus`
 * 6. Run retention cleanup — delete oldest files when count > retention
 *
 * On failure, `backupLastRunStatus` is set to `'error'` before re-throwing
 * so the scheduler layer or caller sees the failure.
 *
 * Exposed so the scheduler, instrumentation, or API handler can call it.
 *
 * Uses dynamic import for `@/db` (same pattern as `createBackupBuffer`) to
 * keep the module build-safe for server-only usage without forcing a static
 * `import 'server-only'` declaration on this file.
 *
 * Accepts an optional `dbParam` for testability. When provided, the caller
 * (typically a test) passes a drizzle instance directly, bypassing the
 * `server-only` guard in `@/db/index`. When omitted, the function dynamically
 * imports `@/db/index` — the production path used by the scheduler and
 * instrumentation hook.
 *
 * @param dbParam - Optional drizzle ORM instance (for testing without server context)
 */
export async function runBackupJob(
  dbParam?: ReturnType<typeof drizzle<typeof schemaTypes>>,
): Promise<void> {
  const db = dbParam ?? (await import('@/db/index')).db;
  const { settings } = await import('@/db/schema');

  const timestamp = new Date().toISOString();

  // 1. Read settings from DB to get retention count and row identity
  const row = db.select().from(settings).limit(1).get();
  const retentionCount = row?.backupRetentionCount ?? 3;

  try {
    // 2. Create the backup ZIP buffer (handles WAL checkpoint + serialization)
    //    Pass dbParam so createBackupBuffer uses the same DB handle
    const buffer = await createBackupBuffer(db);

    // 3. Ensure backup directory exists
    const backupDir = getBackupDir();
    mkdirSync(backupDir, { recursive: true });

    // 4. Write ZIP to disk with sanitised filename
    //    Replace colons (:) and periods (.) with dashes for cross-platform safety;
    //    lexicographic ordering is preserved since timestamp digits are unchanged.
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const filename = `backup-${safeTimestamp}.zip`;
    const filePath = join(backupDir, filename);
    writeFileSync(filePath, buffer);

    const fileSizeKB = Math.round(buffer.length / 1024);
    console.log(
      `[backup] Written: "${filename}" (${fileSizeKB} KB) in "${backupDir}"`,
    );

    // 5. Update settings with success status
    if (row?.id) {
      db.update(settings)
        .set({
          backupLastRunAt: timestamp,
          backupLastRunStatus: 'success' as const,
          updatedAt: timestamp,
        })
        .where(eq(settings.id, row.id))
        .run();
    } else {
      // No settings row exists yet — create one with the backup status recorded
      const id = crypto.randomUUID();
      db.insert(settings)
        .values({
          id,
          backupEnabled: false,
          backupRetentionCount: 3,
          backupLastRunAt: timestamp,
          backupLastRunStatus: 'success' as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }

    console.log(
      `[backup] Settings updated: lastRunAt="${timestamp}", lastRunStatus="success"`,
    );

    // 6. Run retention cleanup
    performRetentionCleanup(backupDir, retentionCount);
  } catch (error) {
    // Update settings with error status on failure
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[backup] Backup job failed at ${timestamp}: ${errorMessage}`);

    if (row?.id) {
      db.update(settings)
        .set({
          backupLastRunAt: timestamp,
          backupLastRunStatus: 'error' as const,
          updatedAt: timestamp,
        })
        .where(eq(settings.id, row.id))
        .run();
    }

    // Re-throw so the scheduler / caller knows the job failed
    throw error;
  }
}
