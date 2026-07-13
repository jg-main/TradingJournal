/**
 * /api/backup/restore/[filename] route handler
 *
 * POST /api/backup/restore/[filename]
 *
 * Restores the trading journal from a server-side backup file located on
 * the backup directory. Reads the ZIP from disk, validates it, and executes
 * a full transactional restore (pre-restore snapshot + wipe-and-replace).
 *
 * Path traversal is blocked: only filenames matching /^backup-.+\.zip$/
 * (with no path separators) are accepted.
 *
 * On success:  200 { success, restoredTables, restoredRows, snapshotPath }
 * On invalid filename:  400 { error, details }
 * On validation failure: 400 { error, details }
 * On execution failure:  500 { error, details }
 *
 * Pattern: src/app/api/restore/route.ts, src/lib/restore.ts
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { getBackupDir } from '@/lib/backup-job';
import { validateRestoreZip, executeRestore } from '@/lib/restore';

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate that the filename is safe to use for a server-side restore.
 *
 * Rules:
 *  - Must start with "backup-" and end with ".zip"
 *  - Must not contain path separators ("/" or "\\")
 *  - Must not contain ".." (parent directory traversal)
 *
 * This is a two-layer defense: we check the pattern first, then use
 * path.join to resolve and verify the resolved path is inside the
 * backup directory (defence in depth).
 */
function isValidBackupFilename(filename: string): boolean {
  // Must be a plain filename — no slashes, no parent traversal
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return false;
  }
  // Must match the backup naming pattern
  return /^backup-.+\.zip$/.test(filename);
}

/**
 * Resolve the full file path for a backup filename and verify it is
 * contained within the backup directory (path traversal defense).
 *
 * @param filename - Backup filename (e.g. "backup-2026-07-01T12-00-00-000Z.zip")
 * @returns The resolved absolute path
 * @throws {Error} If the resolved path is outside the backup directory
 */
function resolveBackupPath(filename: string): string {
  const backupDir = getBackupDir();
  const resolvedPath = join(backupDir, filename);

  // Resolve both to absolute paths and verify the resolved path
  // starts with the backup directory (defence in depth against
  // symlink traversal and edge cases in join behaviour)
  const absBackupDir = join(backupDir, '.');
  const absResolved = join(resolvedPath);

  if (!absResolved.startsWith(absBackupDir)) {
    throw new Error('Path traversal detected');
  }

  return resolvedPath;
}

// ── Route Handler ───────────────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;

    // ── 1. Validate filename (path traversal protection) ──────────────
    if (!isValidBackupFilename(filename)) {
      return NextResponse.json(
        {
          error: 'Invalid backup filename',
          details:
            'Filename must match backup-*.zip and must not contain path separators or parent directory references',
        },
        { status: 400 },
      );
    }

    // ── 2. Resolve file path and verify it exists ─────────────────────
    let filePath: string;
    try {
      filePath = resolveBackupPath(filename);
    } catch {
      return NextResponse.json(
        { error: 'Invalid backup filename', details: 'Path traversal detected' },
        { status: 400 },
      );
    }

    if (!existsSync(filePath)) {
      return NextResponse.json(
        {
          error: 'Backup file not found',
          details: `No backup file named "${filename}" exists on the server`,
        },
        { status: 404 },
      );
    }

    console.log(
      JSON.stringify({
        event: 'server_restore_start',
        filename,
        filePath,
        timestamp: new Date().toISOString(),
      }),
    );

    // ── 3. Read the ZIP from disk ─────────────────────────────────────
    let zipBuffer: Buffer;
    try {
      zipBuffer = readFileSync(filePath);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'server_restore_read_error',
          filename,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return NextResponse.json(
        { error: 'Failed to read backup file', details: String(err) },
        { status: 500 },
      );
    }

    // ── 4. Validate before attempting restore ─────────────────────────
    const validation = validateRestoreZip(zipBuffer);
    if (!validation.valid) {
      console.warn(
        JSON.stringify({
          event: 'server_restore_validation_failed',
          filename,
          error: validation.error,
          details: validation.details,
        }),
      );
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 },
      );
    }

    // ── 5. Execute restore (snapshot + transactional wipe-and-replace) ─
    const result = await executeRestore(zipBuffer);

    console.log(
      JSON.stringify({
        event: 'server_restore_success',
        filename,
        snapshotPath: result.snapshotPath,
        restoredTables: result.restoredTables,
        restoredRows: result.restoredRows,
      }),
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'server_restore_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { error: 'Restore failed', details: String(err) },
      { status: 500 },
    );
  }
}
