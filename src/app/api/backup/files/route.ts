/**
 * /api/backup/files route handler
 *
 * GET /api/backup/files
 *
 * Lists available server-side backup files from the backup directory.
 * Returns a sorted array (newest first) with filename, ISO timestamp
 * parsed from the filename, and human-readable file size.
 *
 * Returns an empty array when the backup directory does not exist
 * (no backups have been scheduled yet).
 *
 * Pattern: src/app/api/backup/status/route.ts
 */

import { NextResponse } from 'next/server';
import { getBackupDir } from '@/lib/backup-job';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Format a byte count as a human-readable string.
 *
 * Examples: 512 -> "512 B", 2048 -> "2.00 KB", 1572864 -> "1.50 MB"
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parse the ISO timestamp from a backup filename.
 *
 * Backup files are named `backup-<ISO_TIMESTAMP>.zip` where colons (:)
 * and periods (.) have been replaced with dashes (-) for cross-platform
 * safety. This reverses that replacement to reconstruct a parseable ISO
 * string.
 *
 * Example: "backup-2026-07-01T12-00-00-000Z.zip" ->
 *          "2026-07-01T12:00:00.000Z"
 *
 * Returns the original timestamp portion if parsing fails.
 */
function parseBackupTimestamp(filename: string): string {
  // Extract the timestamp between "backup-" and ".zip"
  const match = filename.match(/^backup-(.+)\.zip$/);
  if (!match) return filename;

  const rawTimestamp = match[1];

  // The safe filename format replaces colons (:) with dashes (-) and
  // periods (.) with dashes (-). However, periods in the timezone
  // suffix ".000Z" also become dashes "-000Z". We need to carefully
  // reconstruct the ISO 8601 format.
  //
  // Strategy: find the last occurrence of "-000Z" and work backwards,
  // knowing the ISO format is like "2026-07-01T12-00-00-000Z".
  // After replacement: 2026-07-01T12-00-00-000Z
  // Original:           2026-07-01T12:00:00.000Z
  //
  // We can find the position of the timezone suffix and reconstruct.

  // Try a simple approach: the ISO format (minus colons/dots) is
  // predictable: YYYY-MM-DDTHH-mm-ss-SSSZ
  // Known pattern: it's always the same structure, replace dashes
  // that separate time components only.

  // The pattern has: the date part uses '-' natively, but time part
  // dashes replace ':'. The last dash before 'Z' replaces '.'.
  // Split on the 'T' to isolate date from time.
  const tIndex = rawTimestamp.indexOf('T');

  if (tIndex === -1) return rawTimestamp;

  // Before 'T' is the date part (YYYY-MM-DD) — native dashes, keep as-is
  // After 'T' is the time part where dashes replace ':' and '.'.
  // The time part format is: HH-mm-ss-SSSZ
  // We replace the first two dashes with ':', the last dash with '.'
  const datePart = rawTimestamp.slice(0, tIndex);
  let timePart = rawTimestamp.slice(tIndex + 1);

  // Remove trailing 'Z' to count segments, then re-add
  const hasZ = timePart.endsWith('Z');
  if (hasZ) timePart = timePart.slice(0, -1);

  // Split by dash — should give [HH, mm, ss, SSS]
  const segments = timePart.split('-');
  // Reconstruct: HH:mm:ss.SSS
  const reconstructed = segments.map((s, i) => {
    if (i === 3) return `.${s}`; // last segment gets a dot
    return i === 0 ? s : `:${s}`; // others get colons
  }).join('');

  return `${datePart}T${reconstructed}${hasZ ? 'Z' : ''}`;
}

// ── Route Handler ───────────────────────────────────────────────────────

export interface BackupFileEntry {
  filename: string;
  isoDate: string;
  sizeBytes: number;
  sizeHuman: string;
}

export async function GET() {
  try {
    const backupDir = getBackupDir();

    // If the backup directory doesn't exist yet, return empty list
    if (!existsSync(backupDir)) {
      return NextResponse.json([]);
    }

    const entries = readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
      .map((filename) => {
        const filePath = join(backupDir, filename);
        let stat;
        try {
          stat = statSync(filePath);
        } catch {
          // Skip files we can't stat (race condition, permissions, etc.)
          return null;
        }

        return {
          filename,
          isoDate: parseBackupTimestamp(filename),
          sizeBytes: stat.size,
          sizeHuman: formatFileSize(stat.size),
        } satisfies BackupFileEntry;
      })
      .filter((entry): entry is BackupFileEntry => entry !== null)
      // Sort newest first (reverse chronological)
      .sort((a, b) => b.isoDate.localeCompare(a.isoDate));

    return NextResponse.json(entries);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list backup files', details: String(error) },
      { status: 500 },
    );
  }
}
