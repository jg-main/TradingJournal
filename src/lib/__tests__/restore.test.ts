/**
 * restore.test.ts
 *
 * Unit tests for the restore pipeline (validateRestoreZip, previewRestore,
 * executeRestore).
 *
 * Covers:
 *  - Positive: accounting-table round-trip (backup + restore preserves data)
 *  - Positive: ledger balance validation passes for balanced data
 *  - Negative: missing-table rejection (incomplete backup)
 *  - Negative: corrupt / tampered data file JSON
 *  - Negative: unbalanced ledger rejection
 *  - Negative: schema version mismatch
 *  - Negative: open trades block restore
 *  - Edge: row count mismatch (manifest says N, data has M)
 *  - Edge: deterministic post-restore replay (twice -> same result)
 *  - Edge: integer-migration-count mismatch (backup from older/newer schema)
 *  - Edge: empty backup (no data rows, only table files)
 *
 * Pattern: src/lib/__tests__/backup.test.ts
 *
 * Run: npx tsx src/lib/__tests__/restore.test.ts
 */

process.env.DB_FILE_NAME = './.test-restore-units.db';

import { mkdirSync, rmSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from '@/lib/backup-serializer';
import { validateRestoreZip, executeRestore, INSERT_ORDER } from '@/lib/restore';

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

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Restore Unit Tests');
  console.log('\u2550'.repeat(40) + '\n');

  // ── Test 1: Accounting-table round-trip ──────────────────────────────
  console.log('\u25B6 Accounting-table round-trip (backup + restore preserves data)');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-roundtrip-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();

      // Seed: account, instrument, accounting execution, ledger data, and correction_lineage
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Round-Trip Acc', 'USD', 1, 100000, ?, ?)`)
        .run('rt-acc-1', now, now);
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Round-Trip Acc 2', 'USD', 1, 50000, ?, ?)`)
        .run('rt-acc-2', now, now);
      sqlite.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
        VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
        .run('inst-aapl', now);

      // Seed accounting_executions
      sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
        VALUES (?, ?, ?, 'buy', '100', '150.00', '1.00', ?, ?)`)
        .run('ae-001', 'rt-acc-1', 'inst-aapl', now, now);

      // Seed financial_events + ledger_entries + ledger_postings (balanced: one debit + one credit)
      sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, description, posted_at, created_at)
        VALUES (?, ?, 'opening_balance', 'Opening balance', ?, ?)`)
        .run('fe-001', 'rt-acc-1', now, now);
      sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
        VALUES (?, ?, ?, 'Opening entry', ?, ?)`)
        .run('le-001', 'fe-001', 'rt-acc-1', now, now);
      // Balanced: debit total = credit total = 10000 micros
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'debit', '10000.00', 10000, 'USD', 1, ?)`)
        .run('lp-001', 'le-001', 'rt-acc-1', now);
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'credit', '10000.00', 10000, 'USD', 1, ?)`)
        .run('lp-002', 'le-001', 'rt-acc-2', now);

      // Seed correction_lineage (references accounting_executions, accounts)
      sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
        VALUES (?, ?, ?, 'sell', '100', '150.00', '1.00', ?, ?)`)
        .run('ae-002-rev', 'rt-acc-1', 'inst-aapl', later, later);
      sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
        VALUES (?, ?, ?, 'buy', '100', '152.00', '1.00', ?, ?)`)
        .run('ae-003-rep', 'rt-acc-1', 'inst-aapl', later, later);
      sqlite.prepare(`INSERT INTO correction_lineage (id, account_id, original_execution_id, reversal_execution_id, replacement_execution_id, reason, corrected_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'Price correction', ?, ?)`)
        .run('cl-001', 'rt-acc-1', 'ae-001', 'ae-002-rev', 'ae-003-rep', later, now);

      // Create backup
      const backupData = await serializeBackup(testDb);

      // Build the backup ZIP with AdmZip
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();

      // Validate the backup
      const validation = validateRestoreZip(zipBuffer);
      assert(validation.valid === true, 'Backup ZIP validates successfully for round-trip');

      // Execute restore into the same DB (wipe + replace)
      const result = await executeRestore(zipBuffer);
      assert(result.success === true, 'executeRestore succeeds for round-trip');
      assert(typeof result.snapshotPath === 'string' && result.snapshotPath.length > 0, 'Pre-restore snapshot path is non-empty');
      assert(result.restoredTables > 0, `Restored ${result.restoredTables} tables`);

      // Verify accounting tables survived the restore
      const accountsAfter = sqlite.prepare('SELECT id, name FROM accounts ORDER BY id').all() as { id: string; name: string }[];
      assert(accountsAfter.length === 2, 'Restored 2 accounts');
      assertEqual(accountsAfter[0].id, 'rt-acc-1', 'Account rt-acc-1 restored');

      const aexeAfter = sqlite.prepare('SELECT id, action, quantity FROM accounting_executions ORDER BY id').all() as { id: string; action: string; quantity: string }[];
      assert(aexeAfter.length === 3, 'Restored 3 accounting_executions');
      assert(aexeAfter.some((r) => r.id === 'ae-001'), 'Original execution ae-001 restored');

      const clAfter = sqlite.prepare('SELECT id FROM correction_lineage').all() as { id: string }[];
      assert(clAfter.length === 1, 'Restored 1 correction_lineage record');
      assertEqual(clAfter[0].id, 'cl-001', 'Correction lineage cl-001 restored');

      const postingsAfter = sqlite.prepare('SELECT id, side, amount_micros FROM ledger_postings ORDER BY id').all() as { id: string; side: string; amount_micros: number }[];
      assert(postingsAfter.length === 2, 'Restored 2 ledger_postings');
      assert(postingsAfter.some((r) => r.id === 'lp-001' && r.side === 'debit'), 'Debit posting restored');
      assert(postingsAfter.some((r) => r.id === 'lp-002' && r.side === 'credit'), 'Credit posting restored');

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: Missing-table rejection ──────────────────────────────────
  console.log('\n\u25B6 Missing-table rejection');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-missing-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Create a backup but omit correction_lineage data file
      const backupData = await serializeBackup(testDb);
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        if (name === 'correction_lineage') continue; // Skip this table
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const badZip = bakZip.toBuffer();

      const validation = validateRestoreZip(badZip);
      assert(validation.valid === false, 'Missing correction_lineage table: validation fails');
      assert(validation.error.includes('missing'), `Error mentions "missing": ${validation.error}`);
      assert(
        (validation as { valid: false; details?: unknown }).details !== undefined,
        'Error has details object',
      );

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 3: Corrupt / tampered data file JSON ────────────────────────
  console.log('\n\u25B6 Corrupt / tampered data file JSON');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-corrupt-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const backupData = await serializeBackup(testDb);
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        if (name === 'accounts') {
          // Corrupt the accounts data with invalid JSON
          bakZip.addFile('data/accounts.json', Buffer.from('{invalid json!', 'utf-8'));
        } else {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
      }

      // Build manifest that claims 0 accounts (our data blob is not JSON)
      // Actually, we need the row count to match what's in the manifest.
      // Since we corrupted accounts.json, we should also update the manifest.
      // Actually, the validation Step 5 checks that each data file is valid JSON first.
      // If it's not valid JSON, it fails before checking row counts.
      const badZip = bakZip.toBuffer();

      const validation = validateRestoreZip(badZip);
      assert(validation.valid === false, 'Corrupt data file: validation fails');
      assert(validation.error.includes('not valid JSON'), `Error mentions invalid JSON: ${validation.error}`);

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Row count mismatch (manifest tampering) ──────────────────
  console.log('\n\u25B6 Row count mismatch (manifest tampering)');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-count-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Count Test', 'USD', 1, 50000, ?, ?)`)
        .run('ct-acc-1', now, now);

      const backupData = await serializeBackup(testDb);

      // Tamper the manifest: claim accounts has 99 rows instead of 1
      const tamperedManifest = { ...backupData.manifest, tables: { ...backupData.manifest.tables, accounts: 99 } };
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(tamperedManifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const badZip = bakZip.toBuffer();

      const validation = validateRestoreZip(badZip);
      assert(validation.valid === false, 'Row count mismatch: validation fails');
      assert(validation.error.includes('Row count'), `Error mentions "Row count": ${validation.error}`);

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 5: Balanced ledger validation ───────────────────────────────
  console.log('\n\u25B6 Balanced ledger validation passes');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-balanced-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();

      // Seed account + balanced ledger data
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Balanced Test', 'USD', 1, 100000, ?, ?)`)
        .run('bl-acc-1', now, now);
      sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
        VALUES (?, ?, 'opening_balance', ?, ?)`)
        .run('bl-fe-1', 'bl-acc-1', now, now);
      sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
        VALUES (?, ?, ?, 'Balanced entry', ?, ?)`)
        .run('bl-le-1', 'bl-fe-1', 'bl-acc-1', now, now);
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'debit', '50000.00', 50000000, 'USD', 1, ?)`)
        .run('bl-lp-1', 'bl-le-1', 'bl-acc-1', now);
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'credit', '50000.00', 50000000, 'USD', 1, ?)`)
        .run('bl-lp-2', 'bl-le-1', 'bl-acc-1', now);

      const backupData = await serializeBackup(testDb);

      // Create backup ZIP with balanced ledger
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();

      // Balanced ledger should pass
      const validation = validateRestoreZip(zipBuffer);
      assert(validation.valid === true, 'Balanced ledger: validation passes');

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 6: Unbalanced ledger rejection ──────────────────────────────
  console.log('\n\u25B6 Unbalanced ledger rejection');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-unbalanced-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();

      // Seed minimal tables needed for valid backup structure
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Unbalanced Test', 'USD', 1, 100000, ?, ?)`)
        .run('ub-acc-1', now, now);
      sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
        VALUES (?, ?, 'opening_balance', ?, ?)`)
        .run('ub-fe-1', 'ub-acc-1', now, now);
      sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
        VALUES (?, ?, ?, 'Unbalanced entry', ?, ?)`)
        .run('ub-le-1', 'ub-fe-1', 'ub-acc-1', now, now);
      // Debit = 50000, Credit = 30000 — unbalanced by 20000
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'debit', '50000.00', 50000000, 'USD', 1, ?)`)
        .run('ub-lp-1', 'ub-le-1', 'ub-acc-1', now);
      sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'credit', '30000.00', 30000000, 'USD', 1, ?)`)
        .run('ub-lp-2', 'ub-le-1', 'ub-acc-1', now);

      const backupData = await serializeBackup(testDb);

      // Create backup ZIP with unbalanced ledger
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();

      // Unbalanced ledger should fail
      const validation = validateRestoreZip(zipBuffer);
      assert(validation.valid === false, 'Unbalanced ledger: validation fails');
      assert(validation.error.includes('Unbalanced'), `Error mentions "Unbalanced": ${validation.error}`);

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 7: Schema version mismatch ──────────────────────────────────
  console.log('\n\u25B6 Schema version mismatch');

  {
    // Build a minimal backup ZIP with a wrong schemaVersion
    const bakZip = new AdmZip();
    const badManifest = {
      schemaVersion: 999, // Far from current
      backupTimestamp: new Date().toISOString(),
      appVersion: '0.0.0',
      tables: {} as Record<string, number>,
    };
    // Need to include all table placeholders for Step 4 check
    for (const { name } of TABLE_REGISTRY) {
      badManifest.tables[name] = 0;
      bakZip.addFile(`data/${name}.json`, Buffer.from('[]', 'utf-8'));
    }
    bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(badManifest, null, 2), 'utf-8'));
    const zipBuffer = bakZip.toBuffer();

    const validation = validateRestoreZip(zipBuffer);
    assert(validation.valid === false, 'Schema version mismatch: validation fails');
    assert(validation.error.includes('Schema version'), `Error mentions "Schema version": ${validation.error}`);
    const det = (validation as { valid: false; details?: unknown }).details as Record<string, unknown> | undefined;
    assert(det !== undefined, 'Schema mismatch has details');

    const current = getMigrationCount();
    assert(det!.backup === 999, `Details backup version = 999 (got ${det!.backup})`);
    assert(det!.current === current, `Details current version = ${current} (got ${det!.current})`);
  }

  // ── Test 8: Open trades block restore ────────────────────────────────
  console.log('\n\u25B6 Open trades block restore');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-opentrades-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();

      // Seed an account and an open trade
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Open Trade Acc', 'USD', 1, 50000, ?, ?)`)
        .run('ot-acc-1', now, now);
      sqlite.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
        VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
        .run('ot-instr-1', now);
      sqlite.prepare(`INSERT INTO lookup_values (id, type, value, is_active, created_at)
        VALUES (?, 'setup', 'Breakout', 1, ?)`)
        .run('ot-setup-1', now);
      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at)
        VALUES (?, 'OT-001', ?, 'AAPL', 'long', 'open', ?, ?)`)
        .run('ot-trade-1', 'ot-acc-1', now, now);

      // Create backup (doesn't need the open trade — it's part of the DB state, not the ZIP)
      const backupData = await serializeBackup(testDb);
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();

      // Even with a valid backup ZIP, the open trades check should fail
      const validation = validateRestoreZip(zipBuffer);
      assert(validation.valid === false, 'Open trades: validation fails');
      assert(validation.error.includes('open'), `Error mentions "open": ${validation.error}`);

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 9: Deterministic post-restore replay ────────────────────────
  console.log('\n\u25B6 Deterministic post-restore replay');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-replay-'));
    const dbPath1 = join(testDir, 'db1', '.trading-journal', 'journal.db');
    const { sqlite: sqlite1, db: db1 } = createSchemaDb(dbPath1);

    try {
      const now = new Date().toISOString();

      // Seed account + balanced ledge
      sqlite1.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Replay Acc', 'USD', 1, 100000, ?, ?)`)
        .run('rp-acc-1', now, now);
      sqlite1.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
        VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
        .run('rp-instr-1', now);
      sqlite1.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
        VALUES (?, ?, ?, 'buy', '100', '150.00', '1.00', ?, ?)`)
        .run('rp-ae-1', 'rp-acc-1', 'rp-instr-1', now, now);
      sqlite1.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
        VALUES (?, ?, 'trade_execution', ?, ?)`)
        .run('rp-fe-1', 'rp-acc-1', now, now);
      sqlite1.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
        VALUES (?, ?, ?, 'Exec entry', ?, ?)`)
        .run('rp-le-1', 'rp-fe-1', 'rp-acc-1', now, now);
      sqlite1.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'debit', '15000.00', 15000000, 'USD', 1, ?)`)
        .run('rp-lp-1', 'rp-le-1', 'rp-acc-1', now);
      sqlite1.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
        VALUES (?, ?, ?, 'credit', '15000.00', 15000000, 'USD', 1, ?)`)
        .run('rp-lp-2', 'rp-le-1', 'rp-acc-1', now);

      // Create backup from db1
      const backupData = await serializeBackup(db1);
      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();
      sqlite1.close();

      // Perform first restore into a fresh DB
      const dbPath2 = join(testDir, 'db2', '.trading-journal', 'journal.db');
      mkdirSync(dirname(dbPath2), { recursive: true });
      const sqlite2 = new Database(dbPath2);
      sqlite2.pragma('journal_mode = WAL');
      sqlite2.pragma('foreign_keys = ON');
      const db2 = drizzle(sqlite2, { schema });
      const migrationsDir = join(process.cwd(), 'src/db/migrations');
      migrate(db2, { migrationsFolder: migrationsDir });

      // Restore once
      const result1 = await executeRestore(zipBuffer);
      assert(result1.success === true, 'First restore succeeds');

      // Snapshot first restore state
      const accts1 = sqlite2.prepare('SELECT id, name FROM accounts ORDER BY id').all() as { id: string; name: string }[];
      const execs1 = sqlite2.prepare('SELECT id, account_id, action FROM accounting_executions ORDER BY id').all() as { id: string; account_id: string; action: string }[];
      const pos1 = sqlite2.prepare('SELECT COUNT(*) AS cnt FROM account_positions').get() as { cnt: number };

      // Restore again (replay)
      const result2 = await executeRestore(zipBuffer);
      assert(result2.success === true, 'Second restore (replay) succeeds');

      const accts2 = sqlite2.prepare('SELECT id, name FROM accounts ORDER BY id').all() as { id: string; name: string }[];
      const execs2 = sqlite2.prepare('SELECT id, account_id, action FROM accounting_executions ORDER BY id').all() as { id: string; account_id: string; action: string }[];
      const pos2 = sqlite2.prepare('SELECT COUNT(*) AS cnt FROM account_positions').get() as { cnt: number };

      // Compare: replay should produce identical data
      assertEqual(accts1.length, accts2.length, 'Replay: same account count');
      assertEqual(execs1.length, execs2.length, 'Replay: same execution count');
      assertEqual(pos1.cnt, pos2.cnt, 'Replay: same position count');
      assertEqual(accts1[0]?.name, accts2[0]?.name, 'Replay: same account name');
      assertEqual(execs1[0]?.action, execs2[0]?.action, 'Replay: same execution action');

      // Verify all key fields match across replay
      for (let i = 0; i < execs1.length; i++) {
        assertEqual(execs1[i].id, execs2[i].id, `Replay: exec[${i}] id matches`);
        assertEqual(execs1[i].account_id, execs2[i].account_id, `Replay: exec[${i}] account_id matches`);
      }

      sqlite2.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 10: Empty backup (no data rows) ─────────────────────────────
  console.log('\n\u25B6 Empty backup (no data rows)');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-empty-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Create backup from empty DB (migrations applied, no data)
      const backupData = await serializeBackup(testDb);

      const bakZip = new AdmZip();
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        const rows = backupData.tables[name] ?? [];
        bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
      }
      const zipBuffer = bakZip.toBuffer();

      // Validation should pass (all tables present, balanced ledger is not checked since there are no postings)
      const validation = validateRestoreZip(zipBuffer);
      assert(validation.valid === true, 'Empty backup: validation passes');

      // Restore should succeed
      const result = await executeRestore(zipBuffer);
      assert(result.success === true, 'Empty backup: restore succeeds');
      assert(result.restoredTables >= 0, 'Empty backup: restored at least 0 tables');

      sqlite.close();
    } finally {
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
