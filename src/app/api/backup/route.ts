/**
 * /api/backup route handler
 *
 * GET /api/backup
 *
 * Serves a full backup ZIP archive containing journal.db and all uploaded
 * screenshot assets from public/uploads/trades/.
 *
 * Follows the downloadable-file pattern from /api/trades/export.
 */

import { NextResponse } from 'next/server';
import { createBackupArchive } from '@/lib/create-backup';

export async function GET() {
  try {
    // Create the backup archive as a Web ReadableStream
    const stream = await createBackupArchive();

    const filename = `trading-journal-backup-${new Date().toISOString().slice(0, 10)}.zip`;

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create backup archive', details: String(error) },
      { status: 500 },
    );
  }
}
