/**
 * POST /api/restore/preview
 *
 * Validates a backup ZIP and returns its manifest data without mutating
 * the database. Read-only — no data is written.
 *
 * Accepts multipart form data with a `backup` file field.
 *
 * On success:  200 { manifest: BackupManifest }
 * On invalid:  400 { error, details }
 * On error:    500 { error, details }
 */

import { NextResponse } from 'next/server';
import { validateRestoreZip, previewRestore } from '@/lib/restore';

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

    // ── Validate ─────────────────────────────────────────────────────
    const validation = validateRestoreZip(buffer);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 },
      );
    }

    // ── Preview (read-only manifest extraction) ──────────────────────
    const result = previewRestore(buffer);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Unexpected error during restore preview', details: String(err) },
      { status: 500 },
    );
  }
}
