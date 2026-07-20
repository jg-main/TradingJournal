/**
 * GET /uploads/[...path]
 *
 * Serves uploaded files from disk. This is needed because Next.js
 * production server caches the public/ directory at startup, so files
 * added at runtime (e.g. via backup restore) are not served as static assets.
 *
 * Falls back to static file serving in development mode where hot-reload
 * picks up new files automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const filePath = join(process.cwd(), 'public', 'uploads', ...path);
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  try {
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const data = readFileSync(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return new NextResponse(data, {
      status: 200,
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
