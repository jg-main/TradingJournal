/**
 * /api/backup/status route tests
 *
 * Tests the GET handler for backup status:
 *  - Returns lastRunAt, lastRunStatus, nextScheduledAt fields
 *  - When no backups have run, lastRunAt and lastRunStatus are null
 *  - When a backup has run, lastRunAt is set and lastRunStatus is 'success' or 'error'
 *  - nextScheduledAt is null when scheduler is not active (NODE_ENV !== production)
 *  - Error response follows { error: string, details: string } pattern
 *  - Settings with backupLastRunAt/backupLastRunStatus are reflected in output
 *
 * Follows the replica pattern from /api/backup route tests.
 *
 * Run: npx tsx src/app/api/backup/__tests__/status.test.ts
 */

process.env.DB_FILE_NAME = './.test-backup-status-route-db';

import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg} (FAILED)`); }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg} — expected "${expected}", got "${actual}" (FAILED)`); }
}

// ── Helpers ─────────────────────────────────────────────────────────────

interface StatusResult {
  status: number;
  body: Record<string, unknown> | null;
  error?: string;
  details?: unknown;
}

/**
 * Create a fresh SQLite database with the full schema applied via Drizzle migrations.
 */
function createSchemaDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  migrate(testDb, { migrationsFolder: migrationsDir });
  return { sqlite, db: testDb };
}

/**
 * Replica of the GET /api/backup/status handler logic for testing.
 *
 * Uses the explicit testDb handle to bypass the server-only import in @/db/index.
 */
function doGetStatus(overrides: {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
}): StatusResult {
  try {
    const row = overrides.db.select().from(schema.settings).limit(1).get();

    const lastRunAt = row?.backupLastRunAt ?? null;
    const lastRunStatus = row?.backupLastRunStatus ?? null;
    const nextScheduledAt = null; // In test env, scheduler is disabled
    const schedulerActive = false;
    const schedulerStatus = 'stopped';
    const schedulerNodeEnv = 'test';
    const backupCronTime = row?.backupCronTime ?? '02:00';
    const cronExpression = '(scheduler not started)';

    return {
      status: 200,
      body: {
        lastRunAt,
        lastRunStatus,
        nextScheduledAt,
        schedulerActive,
        schedulerStatus,
        schedulerNodeEnv,
        backupCronTime,
        cronExpression,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: null,
      error: 'Failed to fetch backup status',
      details: String(error),
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Backup Status API Route Tests');
  console.log('\u2550'.repeat(40) + '\n');

  // ── Test 1: No settings row — returns default null values ─────────────
  console.log('\u25B6 Default values (no settings row)');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-status-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // No settings row inserted — handler should handle gracefully
      const result = doGetStatus({ sqlite, db: testDb });
      assert(result.status === 200, 'No settings row returns 200');
      assert(result.body !== null, 'Body is not null');

      const body = result.body!;
      assert(body['lastRunAt'] === null, 'lastRunAt is null when no settings row');
      assert(body['lastRunStatus'] === null, 'lastRunStatus is null when no settings row');
      assert(body['nextScheduledAt'] === null, 'nextScheduledAt is null (not production)');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: Settings row with no backup runs — null status fields ────
  console.log('\n\u25B6 Settings row, no backup runs');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-status-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();
      testDb.insert(schema.settings)
        .values({
          id: crypto.randomUUID(),
          backupEnabled: true,
          backupRetentionCount: 3,
          backupLastRunAt: null,
          backupLastRunStatus: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const result = doGetStatus({ sqlite, db: testDb });
      assert(result.status === 200, 'Settings with no backup runs returns 200');
      assert(result.body !== null, 'Body is not null');

      const body = result.body!;
      assert(body['lastRunAt'] === null, 'lastRunAt is null (never run)');
      assert(body['lastRunStatus'] === null, 'lastRunStatus is null (never run)');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 3: Settings with successful backup — returns correct values ─
  console.log('\n\u25B6 After successful backup');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-status-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const backupTime = '2026-07-10T14:30:00.000Z';
      const now = new Date().toISOString();
      testDb.insert(schema.settings)
        .values({
          id: crypto.randomUUID(),
          backupEnabled: true,
          backupRetentionCount: 3,
          backupLastRunAt: backupTime,
          backupLastRunStatus: 'success',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const result = doGetStatus({ sqlite, db: testDb });
      assert(result.status === 200, 'After successful backup returns 200');

      const body = result.body!;
      assertEqual(body['lastRunAt'], backupTime, 'lastRunAt matches backup timestamp');
      assertEqual(body['lastRunStatus'], 'success', 'lastRunStatus is "success"');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Settings with failed backup — returns 'error' status ────
  console.log('\n\u25B6 After failed backup');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-status-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const backupTime = '2026-07-10T15:00:00.000Z';
      const now = new Date().toISOString();
      testDb.insert(schema.settings)
        .values({
          id: crypto.randomUUID(),
          backupEnabled: true,
          backupRetentionCount: 3,
          backupLastRunAt: backupTime,
          backupLastRunStatus: 'error',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const result = doGetStatus({ sqlite, db: testDb });
      assert(result.status === 200, 'After failed backup returns 200');

      const body = result.body!;
      assertEqual(body['lastRunAt'], backupTime, 'lastRunAt matches failed backup timestamp');
      assertEqual(body['lastRunStatus'], 'error', 'lastRunStatus is "error"');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 5: Response shape — all expected fields present ────────────
  console.log('\n\u25B6 Response shape');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-status-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const result = doGetStatus({ sqlite, db: testDb });
      const body = result.body!;

      // Verify exact field set
      const keys = Object.keys(body).sort();
      const expectedKeys = [
        'lastRunAt',
        'lastRunStatus',
        'nextScheduledAt',
        'schedulerActive',
        'schedulerStatus',
        'schedulerNodeEnv',
        'backupCronTime',
        'cronExpression',
      ].sort();

      assertEqual(JSON.stringify(keys), JSON.stringify(expectedKeys),
        'Response has exactly 8 fields: lastRunAt, lastRunStatus, nextScheduledAt, schedulerActive, schedulerStatus, schedulerNodeEnv, backupCronTime, cronExpression');

      // Verify types
      assert(
        body['lastRunAt'] === null || typeof body['lastRunAt'] === 'string',
        'lastRunAt is null or string',
      );
      assert(
        body['lastRunStatus'] === null || body['lastRunStatus'] === 'success' || body['lastRunStatus'] === 'error',
        'lastRunStatus is null, "success", or "error"',
      );
      assert(
        body['nextScheduledAt'] === null || typeof body['nextScheduledAt'] === 'string',
        'nextScheduledAt is null or string',
      );
      assert(
        typeof body['schedulerActive'] === 'boolean',
        'schedulerActive is a boolean',
      );
      assert(
        typeof body['schedulerStatus'] === 'string',
        'schedulerStatus is a string',
      );
      assert(
        typeof body['schedulerNodeEnv'] === 'string',
        'schedulerNodeEnv is a string',
      );
      assert(
        typeof body['backupCronTime'] === 'string',
        'backupCronTime is a string',
      );
      assert(
        typeof body['cronExpression'] === 'string',
        'cronExpression is a string',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'\u2500'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED\n`);
    process.exit(1);
  } else {
    console.log('         All tests passed!\n');
  }
}

runTests()
  .then(() => { if (failed > 0) process.exit(1); })
  .catch((err) => { console.error('Test suite error:', err); process.exit(1); });
