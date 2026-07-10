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
import { Readable } from 'node:stream';
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

// ── Backup archive creation ─────────────────────────────────────────────

/**
 * Create a full backup ZIP archive as a Web ReadableStream.
 *
 * Steps:
 * 1. Checkpoint the SQLite WAL to flush recent writes into the main DB file
 * 2. Serialize all 17 database tables via backup-serializer (per-table JSON)
 * 3. Write manifest.json to the archive root
 * 4. Write data/<tableName>.json for each table in TABLE_REGISTRY order
 * 5. Include uploads/ screenshot assets (skip .gitkeep, no crash if missing)
 * 6. Return a ReadableStream<Uint8Array> for the Response body
 *
 * @returns A ReadableStream<Uint8Array> of the ZIP archive bytes
 * @throws Error if serialization or ZIP creation fails
 */
export async function createBackupArchive(
  dbParam?: ReturnType<typeof drizzle<typeof schema>>
): Promise<ReadableStream<Uint8Array>> {
  // Step 1: WAL checkpoint — flush pending writes into the main DB file
  const database = dbParam ?? (await import('@/db/index')).db;
  database.run(sql.raw('PRAGMA wal_checkpoint(TRUNCATE)'));

  // Step 2: Serialize all tables via the JSON serializer
  const backupData = await serializeBackup(database);

  // Step 3: Create the archiver ZIP instance
  const archive = new ZipArchive({ zlib: { level: 9 } });

  // Step 4: Wire the web stream BEFORE finalizing — data must flow as archiver
  //         produces it. The web stream consumer connects to the archiver's
  //         Node.js Readable stream via nodeStreamToWeb.
  const webStream = nodeStreamToWeb(archive);

  // Step 5: Write manifest.json to the archive root
  archive.append(JSON.stringify(backupData.manifest, null, 2), { name: 'manifest.json' });

  // Step 6: Write per-table JSON files under data/
  for (const { name } of TABLE_REGISTRY) {
    const rows = backupData.tables[name] ?? [];
    archive.append(JSON.stringify(rows, null, 2), { name: `data/${name}.json` });
  }

  // Step 7: Add uploaded screenshot assets
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

  // Step 8: Finalize the archive (no more files can be added) —
  //         finalize() triggers the data flow through the stream.
  //         The Node.js stream pushes to the Web ReadableStream's
  //         controller as chunks are produced.
  archive.finalize();

  // Step 9: Return the web ReadableStream for the Response body
  return webStream;
}
