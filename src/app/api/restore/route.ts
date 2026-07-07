/**
 * POST /api/restore
 *
 * Validates and executes a full restore from a backup ZIP.
 *
 * Steps:
 * 1. Parse the uploaded backup file from multipart form data
 * 2. Validate ZIP integrity, manifest, schema version, table completeness,
 *    and open-trades guard
 * 3. Execute the restore: pre-restore snapshot → transactional
 *    wipe-and-replace with FK-safe insertion ordering
 *
 * Accepts multipart form data with a `backup` file field.
 *
 * On success:  200 { success, restoredTables, restoredRows, snapshotPath }
 * On invalid:  400 { error, details }
 * On failure:  500 { error, details }
 */

import { NextResponse } from 'next/server';
import { validateRestoreZip, executeRestore } from '@/lib/restore';

export async function POST(request: Request) {
  try {
    // ── Parse multipart form data ────────────────────────────────────
    let buffer: Buffer;
    try {
      const formData = await request.formData();
      const file = formData.get('backup');

      if (!file || !(file instanceof Blob)) {
        return NextResponse.json(
          { error: 'Missing backup file', details: 'Form field "backup" is required' },
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to read upload', details: String(err) },
        { status: 400 },
      );
    }

    // ── Validate before attempting restore ───────────────────────────
    const validation = validateRestoreZip(buffer);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 },
      );
    }

    // ── Execute restore (snapshot + transactional wipe-and-replace) ──
    const result = await executeRestore(buffer);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Restore failed', details: String(err) },
      { status: 500 },
    );
  }
}
