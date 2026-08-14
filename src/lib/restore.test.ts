// @vitest-environment node
/**
 * restore.test.ts
 *
 * Unit tests for the restore pipeline (validateRestoreZip, executeRestore).
 *
 * Vitest runs this file in the 'node' environment (via comment directive)
 * to avoid adm-zip compatibility issues with jsdom.
 *
 * Covers:
 *  - Positive: accounting-table round-trip (backup + restore preserves accounting data)
 *  - Positive: balanced ledger validation passes
 *  - Negative: missing-table rejection (incomplete backup)
 *  - Negative: corrupt / tampered data file JSON
 *  - Negative: unbalanced ledger rejection
 *  - Negative: schema version mismatch
 *  - Negative: open trades block restore
 *  - Edge: row count mismatch (manifest says N, data has M)
 *  - Edge: deterministic post-restore replay
 *  - Edge: empty backup (no data rows, only table placeholders)
 *
 * Run: npx vitest run src/lib/restore.test.ts
 */

// vi.hoisted runs BEFORE the file's imports are evaluated, so @/db/index
// (imported transitively via @/lib/restore -> @/db/index) binds DB_FILE to
// this throwaway database instead of the real ./.trading-journal/journal.db.
// Previously the assignment lived in the module body, where ESM import
// hoisting defeated it (the singleton initialized against the real DB with
// 740+ open trades, failing the validation suites).
vi.hoisted(() => {
  process.env.DB_FILE_NAME = './.test-restore-vitest.db';
});

import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from '@/lib/backup-serializer';
import {
  validateRestoreZip,
  executeRestore,
  validateRestoreUploadEntries,
  stageUploadSwap,
} from '@/lib/restore';
import { getSqliteHandle } from '@/db/index';

vi.mock('server-only', () => ({}));

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

function restoreOptions(testDir: string) {
  return { uploadsDir: join(testDir, 'uploads') };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Restore Pipeline', () => {
  describe('restore upload validation', () => {
    const fakeZip = (...entryNames: string[]) => ({
      getEntries: () => entryNames.map((entryName) => ({ entryName })),
    }) as unknown as AdmZip;

    it.each([
      'uploads/../../../.env',
      'uploads/..\\..\\.env',
      'uploads/nested/screenshot.png',
      'uploads/screenshot.exe',
    ])('rejects unsafe or duplicate upload entry %s', (entryName) => {
      expect(validateRestoreUploadEntries(fakeZip(entryName))).toMatchObject({ valid: false });
    });

    it('rejects duplicate upload names', () => {
      expect(
        validateRestoreUploadEntries(fakeZip('uploads/screenshot.png', 'uploads/screenshot.png')),
      ).toMatchObject({ valid: false });
    });

    it('accepts a flat application-generated image entry', () => {
      const zip = new AdmZip();
      zip.addFile('uploads/screenshot.png', Buffer.from('asset'));

      expect(validateRestoreUploadEntries(zip)).toEqual({ valid: true });
    });

    it('restores the previous directory on rollback and clears empty archives', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-upload-swap-'));
      const uploadsDir = join(testDir, 'uploads');
      mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(join(uploadsDir, 'old.png'), 'old');

      try {
        const replacementZip = new AdmZip();
        replacementZip.addFile('uploads/new.png', Buffer.from('new'));
        const replacement = stageUploadSwap(replacementZip, uploadsDir);
        replacement.swap();
        expect(readFileSync(join(uploadsDir, 'new.png'), 'utf8')).toBe('new');
        replacement.rollback();
        expect(readFileSync(join(uploadsDir, 'old.png'), 'utf8')).toBe('old');
        expect(existsSync(join(uploadsDir, 'new.png'))).toBe(false);
        replacement.cleanup();

        const empty = stageUploadSwap(new AdmZip(), uploadsDir);
        empty.swap();
        expect(existsSync(join(uploadsDir, 'old.png'))).toBe(false);
        empty.cleanup();
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — accounting-table round-trip', () => {
    it('preserves accounting tables through backup + restore cycle', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-rt-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const now = new Date().toISOString();
        const later = new Date(Date.now() + 1000).toISOString();

        sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'RT Acc', 'USD', 1, 100000, ?, ?)`)
          .run('rt-acc-1', now, now);
        sqlite.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
          VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
          .run('rt-instr-1', now);
        sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
          VALUES (?, ?, ?, 'buy', '100.00', '150.00', '1.00', ?, ?)`)
          .run('rt-ae-1', 'rt-acc-1', 'rt-instr-1', now, now);
        sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
          VALUES (?, ?, ?, 'sell', '100.00', '150.00', '1.00', ?, ?)`)
          .run('rt-ae-rev', 'rt-acc-1', 'rt-instr-1', later, later);
        sqlite.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
          VALUES (?, ?, ?, 'buy', '100.00', '152.00', '1.00', ?, ?)`)
          .run('rt-ae-rep', 'rt-acc-1', 'rt-instr-1', later, later);

        sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
          VALUES (?, ?, 'opening_balance', ?, ?)`)
          .run('rt-fe-1', 'rt-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
          VALUES (?, ?, ?, 'Opening entry', ?, ?)`)
          .run('rt-le-1', 'rt-fe-1', 'rt-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'debit', '10000.00', 10000, 'USD', 1, ?)`)
          .run('rt-lp-1', 'rt-le-1', 'rt-acc-1', now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'credit', '10000.00', 10000, 'USD', 1, ?)`)
          .run('rt-lp-2', 'rt-le-1', 'rt-acc-1', now);
        sqlite.prepare(`INSERT INTO correction_lineage (id, account_id, original_execution_id, reversal_execution_id, replacement_execution_id, reason, corrected_at, created_at)
          VALUES (?, ?, ?, ?, ?, 'Price correction', ?, ?)`)
          .run('rt-cl-1', 'rt-acc-1', 'rt-ae-1', 'rt-ae-rev', 'rt-ae-rep', later, now);
        sqlite.prepare(`INSERT INTO accounting_migration_runs
          (id, account_id, status, total_records, mapped_count, anomaly_count, unsupported_count, duplicate_count, started_at, completed_at, created_at)
          VALUES (?, ?, 'completed', 1, 1, 0, 0, 0, ?, ?, ?)`)
          .run('rt-mr-1', 'rt-acc-1', now, later, now);
        sqlite.prepare(`INSERT INTO accounting_migration_records
          (id, run_id, source_table, source_id, status, record_type, created_at)
          VALUES (?, ?, 'trade_executions', ?, 'mapped', 'execution', ?)`)
          .run('rt-mrec-1', 'rt-mr-1', 'rt-ae-1', now);
        sqlite.prepare(`INSERT INTO dashboard_views
          (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
          VALUES (?, 'Restore View', '[]', '[]', ?, ?, 0, 1)`)
          .run('rt-view-1', now, now);

        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();

        const validation = validateRestoreZip(zipBuffer);
        expect(validation.valid).toBe(true);

        const result = await executeRestore(zipBuffer, restoreOptions(testDir));
        expect(result.success).toBe(true);
        expect(result.snapshotPath).toBeTruthy();

        const restoredSqlite = getSqliteHandle();
        const accts = restoredSqlite.prepare('SELECT id FROM accounts ORDER BY id').all() as { id: string }[];
        expect(accts.length).toBe(1);
        expect(accts[0].id).toBe('rt-acc-1');

        const execs = restoredSqlite.prepare('SELECT id, action FROM accounting_executions ORDER BY id').all() as { id: string; action: string }[];
        expect(execs.length).toBe(3);
        expect(execs.find((r: { id: string }) => r.id === 'rt-ae-1')?.action).toBe('buy');

        const cl = restoredSqlite.prepare('SELECT id FROM correction_lineage').all() as { id: string }[];
        expect(cl.length).toBe(1);
        expect(cl[0].id).toBe('rt-cl-1');

        expect(
          restoredSqlite.prepare('SELECT id FROM accounting_migration_runs').get(),
        ).toEqual({ id: 'rt-mr-1' });
        expect(
          restoredSqlite.prepare('SELECT id FROM accounting_migration_records').get(),
        ).toEqual({ id: 'rt-mrec-1' });
        expect(
          restoredSqlite.prepare('SELECT id FROM dashboard_views').get(),
        ).toEqual({ id: 'rt-view-1' });

        // Maintenance restore temporarily bypasses immutable DELETE triggers,
        // but must restore them before committing.
        expect(() => {
          restoredSqlite.prepare('DELETE FROM ledger_postings WHERE id = ?').run('rt-lp-1');
        }).toThrow(/Cannot delete a posted ledger posting/);
        expect(() => {
          restoredSqlite.prepare('DELETE FROM accounting_migration_runs WHERE id = ?').run('rt-mr-1');
        }).toThrow(/Cannot delete a migration run/);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — balanced ledger', () => {
    it('accepts backup with balanced ledger postings', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-bl-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const now = new Date().toISOString();

        sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Balanced', 'USD', 1, 100000, ?, ?)`)
          .run('bl-acc-1', now, now);
        sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
          VALUES (?, ?, 'opening_balance', ?, ?)`)
          .run('bl-fe-1', 'bl-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
          VALUES (?, ?, ?, 'Entry', ?, ?)`)
          .run('bl-le-1', 'bl-fe-1', 'bl-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'debit', '50000.00', 50000000, 'USD', 1, ?)`)
          .run('bl-lp-1', 'bl-le-1', 'bl-acc-1', now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'credit', '50000.00', 50000000, 'USD', 1, ?)`)
          .run('bl-lp-2', 'bl-le-1', 'bl-acc-1', now);

        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();

        const validation = validateRestoreZip(zipBuffer);
        expect(validation.valid).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — missing-table rejection', () => {
    it('rejects backup missing correction_lineage data file', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-mt-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          if (name === 'correction_lineage') continue;
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const badZip = bakZip.toBuffer();

        const validation = validateRestoreZip(badZip);
        expect(validation.valid).toBe(false);
        if (!validation.valid) {
          expect(validation.error.toLowerCase()).toContain('missing');
        }
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('accepts existing backups that predate late-registered tables', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-compat-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        for (const { name, optionalInExistingBackups } of TABLE_REGISTRY) {
          if (optionalInExistingBackups) delete backupData.manifest.tables[name];
        }
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name, optionalInExistingBackups } of TABLE_REGISTRY) {
          if (optionalInExistingBackups) continue;
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }

        expect(validateRestoreZip(bakZip.toBuffer())).toEqual({ valid: true });
      } finally {
        sqlite.close();
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('accepts a same-version archive created before target adjustments were registered', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-target-adjustments-compat-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        delete backupData.manifest.tables.trade_target_adjustments;
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));

        for (const { name } of TABLE_REGISTRY) {
          if (name === 'trade_target_adjustments') continue;
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? []), 'utf-8'));
        }

        expect(validateRestoreZip(bakZip.toBuffer())).toEqual({ valid: true });
      } finally {
        sqlite.close();
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('rejects an optional table count when its data file is absent', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-optional-count-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        backupData.manifest.tables.dashboard_views = 1;
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          if (name === 'dashboard_views') continue;
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? []), 'utf-8'));
        }

        expect(validateRestoreZip(bakZip.toBuffer())).toMatchObject({
          valid: false,
          error: 'Backup is missing data files',
        });
      } finally {
        sqlite.close();
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — manifest integrity', () => {
    it('rejects a negative table count instead of treating it as an error indicator', () => {
      const zip = new AdmZip();
      const tables: Record<string, number> = {};
      for (const { name } of TABLE_REGISTRY) {
        tables[name] = 0;
        zip.addFile(`data/${name}.json`, Buffer.from('[]', 'utf-8'));
      }
      tables.accounts = -1;
      zip.addFile(
        'manifest.json',
        Buffer.from(JSON.stringify({
          schemaVersion: getMigrationCount(),
          backupTimestamp: new Date().toISOString(),
          appVersion: '0.0.0',
          tables,
        }), 'utf-8'),
      );

      expect(validateRestoreZip(zip.toBuffer())).toMatchObject({
        valid: false,
        error: 'Invalid table counts in backup manifest',
      });
    });
  });

  describe('validateRestoreZip — asset references', () => {
    it('rejects a local trade asset reference with no matching ZIP entry', () => {
      const zip = new AdmZip();
      const tables: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};

      for (const { name } of TABLE_REGISTRY) {
        tables[name] = [];
        counts[name] = 0;
      }
      tables.trade_assets = [{
        id: 'asset-1',
        tradeId: 'trade-1',
        assetType: 'screenshot',
        phase: 'entry',
        filePath: '/uploads/trades/missing.png',
        externalUrl: null,
      }];
      counts.trade_assets = 1;

      zip.addFile('manifest.json', Buffer.from(JSON.stringify({
        schemaVersion: getMigrationCount(),
        backupTimestamp: new Date().toISOString(),
        appVersion: '0.0.0',
        tables: counts,
      }), 'utf-8'));
      for (const { name } of TABLE_REGISTRY) {
        zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(tables[name]), 'utf-8'));
      }

      expect(validateRestoreZip(zip.toBuffer())).toMatchObject({
        valid: false,
        error: 'Backup is missing referenced upload assets',
      });
    });
  });

  describe('validateRestoreZip — corrupt data file JSON', () => {
    it('rejects backup with invalid JSON in data file', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-cj-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          if (name === 'accounts') {
            bakZip.addFile('data/accounts.json', Buffer.from('{not valid json}', 'utf-8'));
          } else {
            const rows = backupData.tables[name] ?? [];
            bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
          }
        }
        const badZip = bakZip.toBuffer();

        const validation = validateRestoreZip(badZip);
        expect(validation.valid).toBe(false);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — unbalanced ledger', () => {
    it('rejects backup with unbalanced ledger_postings', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-ul-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const now = new Date().toISOString();

        sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Unbalanced', 'USD', 1, 100000, ?, ?)`)
          .run('ul-acc-1', now, now);
        sqlite.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
          VALUES (?, ?, 'opening_balance', ?, ?)`)
          .run('ul-fe-1', 'ul-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
          VALUES (?, ?, ?, 'Entry', ?, ?)`)
          .run('ul-le-1', 'ul-fe-1', 'ul-acc-1', now, now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'debit', '50000.00', 50000000, 'USD', 1, ?)`)
          .run('ul-lp-1', 'ul-le-1', 'ul-acc-1', now);
        sqlite.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'credit', '30000.00', 30000000, 'USD', 1, ?)`)
          .run('ul-lp-2', 'ul-le-1', 'ul-acc-1', now);

        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();

        const validation = validateRestoreZip(zipBuffer);
        expect(validation.valid).toBe(false);
        if (!validation.valid) {
          expect(validation.error.toLowerCase()).toContain('unbalanced');
        }
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — schema version mismatch', () => {
    it('rejects backup with wrong schema version', () => {
      const bakZip = new AdmZip();
      const currentVersion = getMigrationCount();
      const badManifest = {
        schemaVersion: currentVersion + 1,
        backupTimestamp: new Date().toISOString(),
        appVersion: '0.0.0',
        tables: {} as Record<string, number>,
      };
      for (const { name } of TABLE_REGISTRY) {
        badManifest.tables[name] = 0;
        bakZip.addFile(`data/${name}.json`, Buffer.from('[]', 'utf-8'));
      }
      bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(badManifest, null, 2), 'utf-8'));
      const zipBuffer = bakZip.toBuffer();

      const validation = validateRestoreZip(zipBuffer);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.error.toLowerCase()).toContain('schema version');
      }
    });
  });

  describe('validateRestoreZip — open trades block', () => {
    it('rejects restore when open trades exist in the database', async () => {
      // validateRestoreZip uses getSqliteHandle() which returns the singleton
      // database handle. We must seed the open trade into that same handle.
      const singletonSqlite = getSqliteHandle();

      try {
        const now = new Date().toISOString();

        // Seed open trade into the singleton DB
        singletonSqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Open Trade', 'USD', 1, 50000, ?, ?)`)
          .run('ot-sg-acc-1', now, now);
        singletonSqlite.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
          VALUES (?, 'OPN', 'OpenTrade Ltd', 'stock', 'USD', 1, ?)`)
          .run('ot-sg-instr-1', now);
        singletonSqlite.prepare(`INSERT INTO lookup_values (id, type, value, is_active, created_at)
          VALUES (?, 'setup', 'Breakout', 1, ?)`)
          .run('ot-sg-setup-1', now);
        singletonSqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at)
          VALUES (?, 'OT-001', ?, 'AAPL', 'long', 'open', ?, ?)`)
          .run('ot-sg-trade-1', 'ot-sg-acc-1', now, now);

        // Create a valid backup ZIP from an empty temp DB for the test
        const testDir = mkdtempSync(join(tmpdir(), 'restore-ot-'));
        const dbPath = join(testDir, '.trading-journal', 'journal.db');
        const { sqlite, db: testDb } = createSchemaDb(dbPath);
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();

        const validation = validateRestoreZip(zipBuffer);
        expect(validation.valid).toBe(false);
        if (!validation.valid) {
          expect(validation.error.toLowerCase()).toContain('open');
        }

        // Clean up singleton DB
        singletonSqlite.prepare('DELETE FROM trades WHERE id = ?').run('ot-sg-trade-1');
        singletonSqlite.prepare('DELETE FROM lookup_values WHERE id = ?').run('ot-sg-setup-1');
        singletonSqlite.prepare('DELETE FROM instruments WHERE id = ?').run('ot-sg-instr-1');
        singletonSqlite.prepare('DELETE FROM accounts WHERE id = ?').run('ot-sg-acc-1');

        sqlite.close();
        rmSync(testDir, { recursive: true, force: true });
      } finally {
        // no-op: singleton handle is managed by the module
      }
    });
  });

  describe('validateRestoreZip — row count mismatch', () => {
    it('rejects backup when manifest row count differs from data file', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-rc-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const now = new Date().toISOString();
        sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Count Test', 'USD', 1, 50000, ?, ?)`)
          .run('ct-acc-1', now, now);

        const backupData = await serializeBackup(testDb);
        const tamperedManifest = {
          ...backupData.manifest,
          tables: { ...backupData.manifest.tables, accounts: 99 },
        };
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(tamperedManifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const badZip = bakZip.toBuffer();

        const validation = validateRestoreZip(badZip);
        expect(validation.valid).toBe(false);
        if (!validation.valid) {
          expect(validation.error.toLowerCase()).toContain('row count');
        }
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('executeRestore — deterministic replay', () => {
    it('produces identical results on second restore', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-dr-'));
      const dbPath1 = join(testDir, 'db1', '.trading-journal', 'journal.db');
      const { sqlite: sqlite1, db: db1 } = createSchemaDb(dbPath1);

      try {
        const now = new Date().toISOString();

        sqlite1.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Replay Acc', 'USD', 1, 100000, ?, ?)`)
          .run('rp-acc-1', now, now);
        sqlite1.prepare(`INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at)
          VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
          .run('rp-instr-1', now);
        sqlite1.prepare(`INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
          VALUES (?, ?, ?, 'buy', '100.00', '150.00', '1.00', ?, ?)`)
          .run('rp-ae-1', 'rp-acc-1', 'rp-instr-1', now, now);
        sqlite1.prepare(`INSERT INTO financial_events (id, account_id, event_type, posted_at, created_at)
          VALUES (?, ?, 'trade_execution', ?, ?)`)
          .run('rp-fe-1', 'rp-acc-1', now, now);
        sqlite1.prepare(`INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
          VALUES (?, ?, ?, 'Entry', ?, ?)`)
          .run('rp-le-1', 'rp-fe-1', 'rp-acc-1', now, now);
        sqlite1.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'debit', '15000.00', 15000000, 'USD', 1, ?)`)
          .run('rp-lp-1', 'rp-le-1', 'rp-acc-1', now);
        sqlite1.prepare(`INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
          VALUES (?, ?, ?, 'credit', '15000.00', 15000000, 'USD', 1, ?)`)
          .run('rp-lp-2', 'rp-le-1', 'rp-acc-1', now);

        const backupData = await serializeBackup(db1);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();
        sqlite1.close();

        const dbPath2 = join(testDir, 'db2', '.trading-journal', 'journal.db');
        mkdirSync(dirname(dbPath2), { recursive: true });
        const sqlite2 = new Database(dbPath2);
        sqlite2.pragma('journal_mode = WAL');
        sqlite2.pragma('foreign_keys = ON');
        const db2 = drizzle(sqlite2, { schema });
        migrate(db2, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });

        const result1 = await executeRestore(zipBuffer, restoreOptions(testDir));
        expect(result1.success).toBe(true);

        const state1 = {
          acctCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c,
          execCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM accounting_executions').get() as { c: number }).c,
          posCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM account_positions').get() as { c: number }).c,
        };

        const result2 = await executeRestore(zipBuffer, restoreOptions(testDir));
        expect(result2.success).toBe(true);

        const state2 = {
          acctCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c,
          execCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM accounting_executions').get() as { c: number }).c,
          posCount: (sqlite2.prepare('SELECT COUNT(*) AS c FROM account_positions').get() as { c: number }).c,
        };

        expect(state1.acctCount).toBe(state2.acctCount);
        expect(state1.execCount).toBe(state2.execCount);
        expect(state1.posCount).toBe(state2.posCount);

        sqlite2.close();
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('executeRestore — FIFO replay failures', () => {
    it('rolls back source rows when FIFO rejects an immutable execution', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-fifo-reject-'));
      const sourceDbPath = join(testDir, 'source', '.trading-journal', 'journal.db');
      const { sqlite: sourceSqlite, db: sourceDb } = createSchemaDb(sourceDbPath);
      const targetSqlite = getSqliteHandle();
      const now = new Date().toISOString();

      try {
        sourceSqlite.prepare(`INSERT INTO accounts
          (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Malformed Source', 'USD', 1, 100000, ?, ?)`)
          .run('fifo-reject-account', now, now);
        sourceSqlite.prepare(`INSERT INTO instruments
          (id, symbol, name, type, currency, is_active, created_at)
          VALUES (?, 'AAPL', 'Apple Inc.', 'stock', 'USD', 1, ?)`)
          .run('fifo-reject-instrument', now);
        sourceSqlite.prepare(`INSERT INTO accounting_executions
          (id, account_id, instrument_id, action, quantity, price, fees, posted_at, created_at)
          VALUES (?, ?, ?, 'sell', '1.00', '100.00', '0.00', ?, ?)`)
          .run('fifo-reject-execution', 'fifo-reject-account', 'fifo-reject-instrument', now, now);

        const backupData = await serializeBackup(sourceDb);
        const zip = new AdmZip();
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? []), 'utf-8'));
        }

        targetSqlite.prepare(`INSERT OR IGNORE INTO accounts
          (id, name, currency, is_active, starting_balance, created_at, updated_at)
          VALUES (?, 'Restore Sentinel', 'USD', 1, 50000, ?, ?)`)
          .run('restore-sentinel', now, now);

        await expect(
          executeRestore(zip.toBuffer(), restoreOptions(testDir)),
        ).rejects.toMatchObject({
          error: 'Restore failed before commit',
        });

        expect(targetSqlite.prepare('SELECT id FROM accounts WHERE id = ?').get('restore-sentinel'))
          .toEqual({ id: 'restore-sentinel' });
        expect(targetSqlite.prepare('SELECT id FROM accounts WHERE id = ?').get('fifo-reject-account'))
          .toBeUndefined();
        expect(targetSqlite.prepare('SELECT id FROM accounting_executions WHERE id = ?').get('fifo-reject-execution'))
          .toBeUndefined();
      } finally {
        sourceSqlite.close();
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('validateRestoreZip — empty backup', () => {
    it('accepts backup with no data rows', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'restore-em-'));
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      try {
        const backupData = await serializeBackup(testDb);
        const bakZip = new AdmZip();
        bakZip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
        for (const { name } of TABLE_REGISTRY) {
          const rows = backupData.tables[name] ?? [];
          bakZip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'));
        }
        const zipBuffer = bakZip.toBuffer();

        const validation = validateRestoreZip(zipBuffer);
        expect(validation.valid).toBe(true);

        const result = await executeRestore(zipBuffer, restoreOptions(testDir));
        expect(result.success).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
