import { NextRequest, NextResponse } from 'next/server';
import { copyFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { getBackupDir } from '@/lib/backup-job';

export const runtime = 'nodejs';

interface ImportBody {
  path?: unknown;
}

/**
 * Imports a project fixture from data/ into the managed server-backup folder.
 * This is development-only: it avoids browser-native picker issues without
 * exposing arbitrary filesystem reads.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Local backup import is only available in development.' }, { status: 404 });
  }

  let body: ImportBody;
  try {
    body = await request.json() as ImportBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (typeof body.path !== 'string' || body.path.length === 0 || body.path.length > 255) {
    return NextResponse.json({ error: 'A project-relative ZIP path is required.' }, { status: 400 });
  }

  const dataDir = realpathSync(resolve(process.cwd(), 'data'));
  const candidate = resolve(dataDir, body.path);
  const relativePath = relative(dataDir, candidate);
  if (relativePath.startsWith('..') || relativePath === '' || !relativePath.endsWith('.zip') || !existsSync(candidate)) {
    return NextResponse.json({ error: 'Path must reference an existing ZIP inside data/.' }, { status: 400 });
  }

  let sourcePath: string;
  try {
    sourcePath = realpathSync(candidate);
  } catch {
    return NextResponse.json({ error: 'Could not resolve the requested backup file.' }, { status: 400 });
  }
  if (relative(dataDir, sourcePath).startsWith('..')) {
    return NextResponse.json({ error: 'Resolved backup file must remain inside data/.' }, { status: 400 });
  }

  const backupDir = getBackupDir();
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-imported-${timestamp}-${basename(sourcePath)}`;
  const destination = resolve(backupDir, filename);
  copyFileSync(sourcePath, destination);

  const stat = statSync(destination);
  return NextResponse.json({
    file: {
      filename,
      isoDate: new Date(stat.mtimeMs).toISOString(),
      sizeBytes: stat.size,
      sizeHuman: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
    },
  });
}
