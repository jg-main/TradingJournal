/**
 * DELETE /api/backup/files/[filename]
 *
 * Deletes a backup file from the server's backup directory.
 * The filename must match the pattern `backup-<ISO_TIMESTAMP>.zip`.
 *
 * Returns 200 JSON with `{ deleted: filename }` on success, or an error
 * payload on failure.
 *
 * Pattern: src/app/api/backup/files/route.ts, src/lib/backup-job.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBackupDir } from '@/lib/backup-job';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;

    // Validate filename pattern for safety — backup filenames use
    // safe timestamps: backup-YYYY-MM-DDTHH-mm-ss-SSSZ.zip
    // Also allow imported backups: backup-imported-<timestamp>-originalname.zip
    if (!filename.match(/^backup(-imported)?-\d{4}-\d{2}-\d{2}T[\d\-Za-z_]+\.zip$/)) {
      return NextResponse.json(
        { error: 'Invalid backup filename pattern.' },
        { status: 400 },
      );
    }

    const backupDir = getBackupDir();
    const filePath = join(backupDir, filename);

    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Backup file not found.' },
        { status: 404 },
      );
    }

    unlinkSync(filePath);
    console.log(`[backup:delete] Deleted backup file "${filename}"`);

    return NextResponse.json({ deleted: filename });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during file deletion';
    console.error('[backup:delete] Failed to delete backup file:', message);
    return NextResponse.json(
      { error: 'Failed to delete backup file', details: message },
      { status: 500 },
    );
  }
}
