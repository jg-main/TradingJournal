/**
 * create-backup.ts
 *
 * Full backup archive (ZIP) creation for the Trading Journal.
 *
 * Produces a ZIP archive containing:
 * - manifest.json      (schema version, backup timestamp, app version, row counts)
 * - data/<table>.json  (per-table JSON arrays for all 17 tables)
 * - uploads/            (all uploaded screenshot assets from public/uploads/trades/)
 *
 * The backup is human-readable, versioned, and self-describing via the manifest,
 * replacing the earlier opaque journal.db-in-ZIP format.
 *
 * Returns a Web ReadableStream<Uint8Array> suitable for use as a
 * Response body in Next.js App Router route handlers.
 *
 * Pattern: src/lib/backup-serializer.ts, src/lib/export-csv.ts
 */

import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type * as schema from '@/db/schema';
import { sql } from 'drizzle-orm';
import { ZipArchive } from 'archiver';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { serializeBackup, TABLE_REGISTRY } from './backup-serializer';

// ── Configuration ───────────────────────────────────────────────────────

function getDbFilePath(): string {
  return process.env.DB_FILE_NAME || './.trading-journal/journal.db';
}

/**
 * Derive the uploads directory from the project root (process.cwd()).
 * Works in both dev and Docker environments.
 */
function getUploadsDir(): string {
  return join(process.cwd(), 'public', 'uploads', 'trades');
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

// ── Archiver-to-Buffer helper ───────────────────────────────────────────

/**
 * Pipe an archiver instance to a Writable stream that collects all chunks
 * and resolves with a single Buffer.
 *
 * The archive must be finalized (via `archive.finalize()`) before or after
 * calling this function — the promise settles when the 'finish' event fires
 * on the writable side.
 */
function archiveToBuffer(archive: ZipArchive): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    archive.on('error', reject);
    writable.on('finish', () => resolve(Buffer.concat(chunks)));
    archive.pipe(writable);
  });
}

// ── Buffer-to-Web-Stream conversion ─────────────────────────────────────

/**
 * Convert a single Buffer into a Web ReadableStream<Uint8Array>.
 *
 * Unlike nodeStreamToWeb which bridges an active Node.js stream, this
 * helper creates a stream that immediately delivers the full buffer and
 * closes — suitable for streaming an already-materialised ZIP buffer to
 * an HTTP Response body.
 */
function bufferToWebStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

// ── Shared ZIP buffer creation (extracted) ──────────────────────────────

/**
 * Create a full backup ZIP archive as an in-memory Buffer.
 *
 * This is the shared core of both the HTTP download path and the scheduled
 * backup path. It performs all the same work as createBackupArchive but
 * returns a Buffer that can be written to disk (scheduled backups) or
 * converted to a stream (manual download).
 *
 * Steps:
 * 1. Checkpoint the SQLite WAL to flush recent writes into the main DB file
 * 2. Serialize all 17 database tables via backup-serializer (per-table JSON)
 * 3. Write manifest.json to the archive root
 * 4. Write data/<tableName>.json for each table in TABLE_REGISTRY order
 * 5. Include uploads/ screenshot assets (skip .gitkeep, no crash if missing)
 * 6. Finalize the archive and collect the ZIP bytes into a Buffer
 *
 * @returns A Promise resolving to the ZIP archive as a Buffer
 * @throws Error if serialization or ZIP creation fails
 */
export async function createBackupBuffer(
  dbParam?: ReturnType<typeof drizzle<typeof schema>>
): Promise<Buffer> {
  // Step 1: WAL checkpoint — flush pending writes into the main DB file
  const database = dbParam ?? (await import('@/db/index')).db;
  database.run(sql.raw('PRAGMA wal_checkpoint(TRUNCATE)'));

  // Step 2: Serialize all tables via the JSON serializer
  const backupData = await serializeBackup(database);

  // Step 3: Create the archiver ZIP instance
  const archive = new ZipArchive({ zlib: { level: 9 } });

  // Step 4: Write manifest.json to the archive root
  archive.append(JSON.stringify(backupData.manifest, null, 2), { name: 'manifest.json' });

  // Step 5: Write per-table JSON files under data/
  for (const { name } of TABLE_REGISTRY) {
    const rows = backupData.tables[name] ?? [];
    archive.append(JSON.stringify(rows, null, 2), { name: `data/${name}.json` });
  }

  // Step 6: Add uploaded screenshot assets
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

  // Step 7: Finalize the archive and collect into a Buffer.
  //         Pipe must be set up before finalize() so data flows through.
  const bufferPromise = archiveToBuffer(archive);
  archive.finalize();

  // Step 8: Wait for all data to be collected and return the Buffer
  return bufferPromise;
}

// ── Backup archive creation (HTTP path) ─────────────────────────────────

/**
 * Create a full backup ZIP archive as a Web ReadableStream.
 *
 * This function is a thin wrapper around createBackupBuffer that converts
 * the resulting Buffer into a ReadableStream<Uint8Array> suitable for use
 * as a Response body in Next.js App Router route handlers.
 *
 * @returns A ReadableStream<Uint8Array> of the ZIP archive bytes
 * @throws Error if serialization or ZIP creation fails
 */
export async function createBackupArchive(
  dbParam?: ReturnType<typeof drizzle<typeof schema>>
): Promise<ReadableStream<Uint8Array>> {
  const buffer = await createBackupBuffer(dbParam);
  return bufferToWebStream(buffer);
}
