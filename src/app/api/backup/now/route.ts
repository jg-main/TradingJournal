/**
 * POST /api/backup/now route handler
 *
 * Triggers an immediate on-demand backup. Calls runBackupJob() which:
 *   1. Creates a backup ZIP via createBackupBuffer()
 *   2. Writes it to the backup directory
 *   3. Updates settings with run status
 *   4. Runs retention cleanup
 *
 * Returns JSON with the backup filename and timestamp on success, or an
 * error payload on failure.
 *
 * Pattern: src/lib/backup-job.ts, src/app/api/backup/status/route.ts
 */

import { NextResponse } from 'next/server';
import { runBackupJob } from '@/lib/backup-job';

export async function POST() {
  try {
    const startTime = Date.now();
    await runBackupJob();
    const elapsedMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      elapsedMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during backup';
    console.error('[backup:now] Backup failed:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
