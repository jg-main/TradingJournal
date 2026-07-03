/**
 * create-backup.ts
 *
 * Full backup archive (ZIP) creation for the Trading Journal.
 *
 * Produces a ZIP archive containing:
 * - journal.db (the SQLite database, after WAL checkpoint)
 * - uploads/ (all uploaded screenshot assets from public/uploads/trades/)
 *
 * Returns a Web ReadableStream<Uint8Array> suitable for use as a
 * Response body in Next.js App Router route handlers.
 *
 * Pattern: src/lib/export-csv.ts, src/lib/dashboard.ts
 */

import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type * as schema from '@/db/schema';
import { sql } from 'drizzle-orm';
import { ZipArchive } from 'archiver';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

// ── Configuration ───────────────────────────────────────────────────────

function getDbFilePath(): string {
  return process.env.DB_FILE_NAME || './.trading-journal/journal.db';
}

/**
 * Derive the uploads directory from the DB file path.
 * The DB lives at <project-root>/.trading-journal/journal.db and uploads
 * live at <project-root>/public/uploads/trades; going up two levels from
 * the DB file lands at the project root.
 */
function getUploadsDir(): string {
  const dbPath = getDbFilePath();
  return join(dirname(dbPath), '..', 'public', 'uploads', 'trades');
}

// ── Stream conversion ───────────────────────────────────────────────────

/**
 * Convert a Node.js Readable stream to a Web ReadableStream<Uint8Array>.
 *
 * This is necessary because archiver emits a Node.js stream, but
 * Next.js App Router route handlers accept Web API ReadableStream.
 */
function nodeStreamToWeb(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

// ── Backup archive creation ─────────────────────────────────────────────

/**
 * Create a full backup ZIP archive as a Web ReadableStream.
 *
 * Steps:
 * 1. Checkpoint the SQLite WAL to flush recent writes into the main DB file
 * 2. Stream journal.db into the ZIP as 'journal.db'
 * 3. Read public/uploads/trades/, filter out .gitkeep, add files with 'uploads/' prefix
 * 4. Handle a missing uploads directory gracefully (skip the directory)
 * 5. Return a ReadableStream<Uint8Array> for the Response body
 *
 * @returns A ReadableStream<Uint8Array> of the ZIP archive bytes
 * @throws Error if the DB file does not exist or ZIP creation fails
 */
export async function createBackupArchive(
  dbParam?: ReturnType<typeof drizzle<typeof schema>>
): Promise<ReadableStream<Uint8Array>> {
  // Step 1: WAL checkpoint — flush pending writes into the main DB file
  const database = dbParam ?? (await import('@/db/index')).db;
  database.run(sql.raw('PRAGMA wal_checkpoint(TRUNCATE)'));

  // Step 2: Create the archiver ZIP instance
  const archive = new ZipArchive({ zlib: { level: 9 } });

  // Step 3: Wire the web stream BEFORE finalizing — data must flow as archiver
  //         produces it. The web stream consumer connects to the archiver's
  //         Node.js Readable stream via nodeStreamToWeb.
  const webStream = nodeStreamToWeb(archive);

  // Step 4: Add the database file
  const dbFilePath = getDbFilePath();
  if (!existsSync(dbFilePath)) {
    throw new Error(`Database file not found at ${dbFilePath}`);
  }

  archive.file(dbFilePath, { name: 'journal.db' });

  // Step 5: Add uploaded screenshot assets
  const uploadsDir = getUploadsDir();
  if (existsSync(uploadsDir)) {
    const files = readdirSync(uploadsDir);
    for (const file of files) {
      // Skip .gitkeep placeholder — it has no useful content
      if (file === '.gitkeep') continue;

      const filePath = join(uploadsDir, file);
      if (statSync(filePath).isFile()) {
        archive.file(filePath, { name: `uploads/${file}` });
      }
    }
  }
  // If uploads directory does not exist, skip gracefully — no uploads to back up

  // Step 6: Finalize the archive (no more files can be added) —
  //         finalize() triggers the data flow through the stream.
  //         The Node.js stream pushes to the Web ReadableStream's
  //         controller as chunks are produced.
  archive.finalize();

  // Step 7: Return the web ReadableStream for the Response body
  return webStream;
}
