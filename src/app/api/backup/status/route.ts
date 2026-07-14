/**
 * /api/backup/status route handler
 *
 * GET /api/backup/status
 *
 * Returns the current backup system status:
 *   - lastRunAt: ISO timestamp of the last backup run, or null if none
 *   - lastRunStatus: 'success', 'error', or null (never run)
 *   - nextScheduledAt: ISO timestamp of the next scheduled cron run, or null
 *     when the scheduler is not active (NODE_ENV !== 'production' or
 *     backups not enabled)
 *
 * Pattern: src/app/api/settings/route.ts, src/lib/scheduler.ts
 */

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { settings, appProfile } from '@/db/schema';
import {
  getNextScheduledAt,
  isSchedulerActive,
  getSchedulerStatus,
  getCurrentCronExpression,
} from '@/lib/scheduler';
import { getBackupDir } from '@/lib/backup-job';

export async function GET() {
  try {
    const row = db.select().from(settings).limit(1).get();
    const profileRow = db.select().from(appProfile).limit(1).get();

    const lastRunAt = row?.backupLastRunAt ?? null;
    const lastRunStatus = row?.backupLastRunStatus ?? null;
    const nextScheduledAt = getNextScheduledAt();
    const schedulerActive = isSchedulerActive();
    const schedulerStatus = getSchedulerStatus();
    const schedulerNodeEnv = process.env.NODE_ENV ?? 'not-set';
    const backupCronTime = row?.backupCronTime ?? '02:00';
    const cronExpression = getCurrentCronExpression() || '(scheduler not started)';
    const appTimezone = profileRow?.timezone ?? 'America/Bogota';
    const backupDir = getBackupDir();

    return NextResponse.json({
      lastRunAt,
      lastRunStatus,
      nextScheduledAt,
      schedulerActive,
      schedulerStatus,
      schedulerNodeEnv,
      backupCronTime,
      cronExpression,
      appTimezone,
      backupDir,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch backup status', details: String(error) },
      { status: 500 },
    );
  }
}
