/**
 * restore.test.ts
 *
 * Comprehensive tests for the restore library.
 *
 * Covers all three exported functions:
 *   - validateRestoreZip  (6 validation scenarios)
 *   - previewRestore      (valid + invalid)
 *   - executeRestore      (round-trip, snapshot, replacement, FK-safe, edge cases)
 *
 * Uses vitest with a mocked server-only module to allow importing @/db/index.
 *
 * Run: npx vitest run src/lib/restore.test.ts
 *
 * Pattern: src/lib/backup-serializer.test.ts, src/lib/create-backup.test.ts
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock server-only BEFORE any imports — vitest hoists vi.mock calls
vi.mock('server-only', () => ({}));

import { rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from './backup-serializer';
import type { BackupManifest } from './backup-serializer';
import { db, getSqliteHandle, initializeDatabase } from '@/db/index';

// Import AFTER server-only mock (lazy — resolved in beforeAll)
let validateRestoreZip: typeof import('./restore')['validateRestoreZip'];
let previewRestore: typeof import('./restore')['previewRestore'];
let executeRestore: typeof import('./restore')['executeRestore'];

beforeAll(async () => {
  const mod = await import('./restore');
  validateRestoreZip = mod.validateRestoreZip;
  previewRestore = mod.previewRestore;
  executeRestore = mod.executeRestore;
});

// ── Helpers ─────────────────────────────────────────────────────────────

const NOW = '2026-07-01T12:00:00.000Z';

function getSqlite(): ReturnType<typeof getSqliteHandle> {
  try {
    return getSqliteHandle();
  } catch {
    initializeDatabase();
    return getSqliteHandle();
  }
}

/**
 * Create a valid backup ZIP in memory using adm-zip.
 */
function createTestZip(overrides?: {
  manifest?: Partial<BackupManifest>;
  tables?: Record<string, Record<string, unknown>[]>;
  dropTables?: string[];
}): Buffer {
  const schemaVersion = getMigrationCount();
  const tableCounts: Record<string, number> = {};
  const tableData: Record<string, Record<string, unknown>[]> = {};

  for (const { name } of TABLE_REGISTRY) {
    const customRows = overrides?.tables?.[name];
    const rows = customRows ?? [];
    tableData[name] = rows;
    tableCounts[name] = rows.length;
  }

  const manifest: BackupManifest = {
    schemaVersion: overrides?.manifest?.schemaVersion ?? schemaVersion,
    backupTimestamp: overrides?.manifest?.backupTimestamp ?? NOW,
    appVersion: overrides?.manifest?.appVersion ?? '1.0.0',
    tables: overrides?.manifest?.tables ?? tableCounts,
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  const dropSet = new Set(overrides?.dropTables ?? []);
  for (const { name } of TABLE_REGISTRY) {
    if (dropSet.has(name)) continue;
    const rows = tableData[name];
    zip.addFile(
      `data/${name}.json`,
      Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'),
    );
  }

  return zip.toBuffer();
}

/**
 * Create a ZIP with lightweight seed data (a few common tables populated).
 */
function createSeedZip(): Buffer {
  const uid = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  return createTestZip({
    tables: {
      app_profile: [
        { id: uid('prof'), displayName: 'Trader', timezone: 'America/New_York', defaultCurrency: 'USD', createdAt: NOW, updatedAt: NOW },
      ],
      accounts: [
        { id: uid('acc'), name: 'Main Account', broker: 'IBKR', currency: 'USD', isActive: true, startingBalance: 50000, createdAt: NOW, updatedAt: NOW },
      ],
      lookup_values: [
        { id: uid('lv'), type: 'sector', value: 'Technology', sortOrder: 1, isActive: true, createdAt: NOW, updatedAt: NOW },
      ],
      settings: [
        { id: uid('set'), startingAccountValue: 50000, maxRiskPerTradePct: 1.0, defaultCommission: 0.005, currency: 'USD', createdAt: NOW, updatedAt: NOW },
      ],
      trades: [],
      trade_executions: [],
      trade_risk_snapshots: [],
      trade_stop_adjustments: [],
      trade_assets: [],
      trade_grades: [],
      trade_mistakes: [],
      watchlist_items: [],
      setup_definitions: [],
      account_transactions: [],
      account_rollforward: [],
      weekly_reviews: [],
      review_action_items: [],
    },
  });
}

/**
 * Clear all data from all tables in FK-safe order.
 */
function clearAllTables() {
  const sqlite = getSqlite();
  const deleteOrder = [
    'review_action_items', 'weekly_reviews', 'account_rollforward',
    'account_transactions', 'watchlist_items', 'trade_mistakes',
    'trade_grades', 'trade_assets', 'trade_stop_adjustments',
    'trade_risk_snapshots', 'trade_executions', 'trades',
    'setup_definitions', 'lookup_values', 'accounts', 'settings', 'app_profile',
  ];
  sqlite.exec('PRAGMA defer_foreign_keys = ON');
  for (const name of deleteOrder) {
    sqlite.exec(`DELETE FROM "${name}"`);
  }
}

/**
 * Count rows in all tables.
 */
function countAllTables(): Record<string, number> {
  const sqlite = getSqlite();
  const counts: Record<string, number> = {};
  for (const { name } of TABLE_REGISTRY) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number };
    counts[name] = row.count;
  }
  return counts;
}

/**
 * Seed a single open trade for the open-trades validation test.
 */
function seedOpenTrade(): string {
  const sqlite = getSqlite();
  const accountId = randomUUID();
  const tradeId = randomUUID();
  sqlite.prepare(`
    INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
    VALUES (?, 'Test Account', 'USD', 1, ?, ?)
  `).run(accountId, NOW, NOW);
  sqlite.prepare(`
    INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'long', 'open', ?, ?, ?)
  `).run(tradeId, `T-${tradeId.slice(0, 4)}`, accountId, 'TEST', NOW, NOW, NOW);
  return tradeId;
}

/**
 * Seed realistic round-trip test data.
 */
function seedRoundTripData(): void {
  const sqlite = getSqlite();
  const accountId = randomUUID();
  const tradeId = randomUUID();
  const lookupId = randomUUID();

  sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
    VALUES (?, 'Round-Trip Trader', 'America/New_York', 'USD', ?)`)
    .run(randomUUID(), NOW);

  sqlite.prepare(`INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
    VALUES (?, 'Round-Trip Account', 'IBKR', 'USD', 1, 100000, ?, ?)`)
    .run(accountId, NOW, NOW);

  sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
    VALUES (?, 'sector', 'Technology', 1, 1, ?, ?)`)
    .run(lookupId, NOW, NOW);

  sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at)
    VALUES (?, 100000, 1.5, 0.003, 'USD', ?, ?)`)
    .run(randomUUID(), NOW, NOW);

  sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'long', ?, 'closed', ?, ?, ?)`)
    .run(tradeId, 'RT-001', accountId, 'AAPL', lookupId, NOW, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
    VALUES (?, ?, ?, 'buy', 100, 180.50, 1.99, ?)`)
    .run(randomUUID(), tradeId, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
    VALUES (?, ?, 100000, 180.50, 175.00, 100, ?)`)
    .run(randomUUID(), tradeId, NOW);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('validateRestoreZip', () => {
  beforeEach(() => {
    clearAllTables();
  });

  it('returns { valid: true } for a valid ZIP', () => {
    const zipBuffer = createSeedZip();
    const result = validateRestoreZip(zipBuffer);
    expect(result.valid).toBe(true);
  });

  it('rejects empty buffer with "Invalid backup file"', () => {
    const result = validateRestoreZip(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Invalid backup file');
    }
  });

  it('rejects corrupt buffer with "Invalid backup file"', () => {
    const result = validateRestoreZip(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Invalid backup file');
    }
  });

  it('rejects missing manifest.json', () => {
    const zip = new AdmZip();
    zip.addFile('data/accounts.json', Buffer.from('[]', 'utf-8'));
    const result = validateRestoreZip(zip.toBuffer());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/missing manifest/i);
    }
  });

  it('rejects schema version mismatch with expected vs actual versions', () => {
    const currentVersion = getMigrationCount();
    const badVersion = currentVersion + 99;
    const zipBuffer = createTestZip({ manifest: { schemaVersion: badVersion } });
    const result = validateRestoreZip(zipBuffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Schema version mismatch');
      const details = result.details as { backup: number; current: number };
      expect(details.backup).toBe(badVersion);
      expect(details.current).toBe(currentVersion);
    }
  });

  it('blocks restore when open trades exist', () => {
    const zipBuffer = createSeedZip();
    seedOpenTrade();
    const result = validateRestoreZip(zipBuffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/trades are open/);
      const details = result.details as { openTradeCount: number };
      expect(details.openTradeCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects backup with missing table files', () => {
    const zipBuffer = createTestZip({ dropTables: ['trade_executions'] });
    const result = validateRestoreZip(zipBuffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/missing data/i);
      const details = result.details as { missingTables: string[] };
      expect(details.missingTables).toContain('trade_executions');
    }
  });
});

describe('previewRestore', () => {
  beforeEach(() => {
    clearAllTables();
  });

  it('returns manifest with backupTimestamp, schemaVersion, and table row counts', () => {
    const zipBuffer = createSeedZip();
    const result = previewRestore(zipBuffer);
    expect(result.manifest).toBeDefined();
    expect(typeof result.manifest.schemaVersion).toBe('number');
    expect(result.manifest.schemaVersion).toBeGreaterThan(0);
    expect(typeof result.manifest.backupTimestamp).toBe('string');
    expect(result.manifest.backupTimestamp.length).toBeGreaterThan(0);
    expect(typeof result.manifest.tables).toBe('object');
    expect(result.manifest.tables['accounts']).toBe(1);
    expect(result.manifest.tables['app_profile']).toBe(1);
    expect(result.manifest.tables['trades']).toBe(0);
  });

  it('throws on invalid ZIP', () => {
    expect(() => previewRestore(Buffer.from('not-a-zip'))).toThrow();
  });
});

describe('executeRestore', () => {
  beforeEach(() => {
    clearAllTables();
  });

  it('full round-trip: seed -> serialize -> ZIP -> restore -> verify all tables match', async () => {
    seedRoundTripData();
    const preCounts = countAllTables();
    expect(preCounts['trades']).toBeGreaterThanOrEqual(1);
    expect(preCounts['trade_executions']).toBeGreaterThanOrEqual(1);

    const backupData = await serializeBackup(db);
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'));
    }

    const restoreResult = await executeRestore(zip.toBuffer());
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables).toBeGreaterThan(0);
    expect(restoreResult.restoredRows).toBeGreaterThan(0);

    const postCounts = countAllTables();
    for (const { name } of TABLE_REGISTRY) {
      expect(postCounts[name]).toBe(preCounts[name]);
    }

    // Verify data content preserved
    const sqlite = getSqlite();
    const tradeRow = sqlite.prepare("SELECT * FROM trades WHERE trade_code = 'RT-001'").get() as Record<string, unknown> | undefined;
    expect(tradeRow).toBeDefined();
    expect(tradeRow!['symbol']).toBe('AAPL');

    // Clean up snapshot
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });

  it('creates a pre-restore snapshot at expected path', async () => {
    seedRoundTripData();
    const backupData = await serializeBackup(db);
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'));
    }

    const restoreResult = await executeRestore(zip.toBuffer());
    expect(typeof restoreResult.snapshotPath).toBe('string');
    expect(restoreResult.snapshotPath.length).toBeGreaterThan(0);
    expect(existsSync(restoreResult.snapshotPath)).toBe(true);

    const snapshotZip = new AdmZip(restoreResult.snapshotPath);
    const manifestEntry = snapshotZip.getEntry('manifest.json');
    expect(manifestEntry).not.toBeNull();

    // Clean up
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });

  it('restore with different row counts replaces correctly (old data wiped, new data present)', async () => {
    const sqlite = getSqlite();

    // Phase 1: Seed data A
    const accA = randomUUID();
    sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
      VALUES (?, 'Account A', 'USD', 1, ?, ?)`).run(accA, NOW, NOW);
    sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
      VALUES (?, 'DATA-A-1', ?, 'AAPL', 'long', 'closed', ?, ?)`)
      .run(randomUUID(), accA, NOW, NOW);

    const backupA = await serializeBackup(db);
    const zipA = new AdmZip();
    zipA.addFile('manifest.json', Buffer.from(JSON.stringify(backupA.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zipA.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupA.tables[name] ?? [], null, 2), 'utf-8'));
    }

    // Phase 2: Seed different data B
    clearAllTables();
    const accB = randomUUID();
    const tradeB = randomUUID();
    sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
      VALUES (?, 'Account B', 'USD', 1, ?, ?)`).run(accB, NOW, NOW);
    sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
      VALUES (?, 'DATA-B-1', ?, 'MSFT', 'long', 'closed', ?, ?)`)
      .run(tradeB, accB, NOW, NOW);
    sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, action, quantity, price, fees, executed_at, created_at)
      VALUES (?, ?, 'buy', 200, 250.00, 2.50, ?, ?)`)
      .run(randomUUID(), tradeB, NOW, NOW);

    expect(countAllTables()['trades']).toBe(1);
    expect(countAllTables()['trade_executions']).toBe(1);

    // Phase 3: Restore from ZIP A
    const restoreResult = await executeRestore(zipA.toBuffer());

    // Phase 4: Verify data matches state A
    const tradeRows = sqlite.prepare("SELECT trade_code, symbol FROM trades").all() as Record<string, unknown>[];
    expect(tradeRows.length).toBe(1);
    expect(tradeRows[0]['trade_code']).toBe('DATA-A-1');
    expect(tradeRows[0]['symbol']).toBe('AAPL');
    expect(countAllTables()['trade_executions']).toBe(0);

    // Clean up
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });

  it('FK-safe ordering: inserts data with foreign key references without violations', async () => {
    const sqlite = getSqlite();
    const accountId = randomUUID();
    const tradeId = randomUUID();
    const lookupId = randomUUID();

    sqlite.prepare(`INSERT INTO accounts (id, name, is_active, created_at, updated_at)
      VALUES (?, 'FK Test Account', 1, ?, ?)`).run(accountId, NOW, NOW);
    sqlite.prepare(`INSERT INTO lookup_values (id, type, value, is_active, created_at, updated_at)
      VALUES (?, 'sector', 'Energy', 1, ?, ?)`).run(lookupId, NOW, NOW);
    sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
      VALUES (?, 'FK-001', ?, 'XOM', 'long', ?, 'open', ?, ?, ?)`)
      .run(tradeId, accountId, lookupId, NOW, NOW, NOW);
    sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, action, quantity, price, executed_at, created_at)
      VALUES (?, ?, 'buy', 50, 85.00, ?, ?)`).run(randomUUID(), tradeId, NOW, NOW);
    sqlite.prepare(`INSERT INTO trade_mistakes (id, trade_id, phase, severity, status, created_at)
      VALUES (?, ?, 'entry', 'minor', 'open', ?)`).run(randomUUID(), tradeId, NOW);
    sqlite.prepare(`INSERT INTO trade_stop_adjustments (id, trade_id, previous_stop, new_stop, created_at)
      VALUES (?, ?, 80.00, 82.00, ?)`).run(randomUUID(), tradeId, NOW);
    sqlite.prepare(`INSERT INTO trade_assets (id, trade_id, asset_type, phase, label, created_at)
      VALUES (?, ?, 'screenshot', 'entry', 'Entry Screenshot', ?)`).run(randomUUID(), tradeId, NOW);

    const backupData = await serializeBackup(db);
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'));
    }

    clearAllTables();
    const restoreResult = await executeRestore(zip.toBuffer());
    expect(restoreResult.success).toBe(true);

    // Verify all FK relationships are intact
    const tradeRow = sqlite.prepare("SELECT id FROM trades WHERE trade_code = 'FK-001'").get() as Record<string, unknown> | undefined;
    expect(tradeRow).toBeDefined();
    const restoredTradeId = tradeRow!['id'] as string;

    const execRow = sqlite.prepare('SELECT * FROM trade_executions WHERE quantity = 50').get() as Record<string, unknown> | undefined;
    expect(execRow).toBeDefined();
    expect(execRow!['trade_id']).toBe(restoredTradeId);

    expect(countAllTables()['trade_mistakes']).toBe(1);
    expect(countAllTables()['trade_stop_adjustments']).toBe(1);
    expect(countAllTables()['trade_assets']).toBe(1);

    // Clean up
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });

  it('handles empty tables in backup (0 rows) — all tables are empty after restore', async () => {
    const sqlite = getSqlite();
    // Pre-seed data
    const accId = randomUUID();
    sqlite.prepare(`INSERT INTO accounts (id, name, is_active, created_at, updated_at)
      VALUES (?, 'Pre-Restore Account', 1, ?, ?)`).run(accId, NOW, NOW);
    sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
      VALUES (?, 'PRE-TRADE', ?, 'AAPL', 'long', 'closed', ?, ?)`)
      .run(randomUUID(), accId, NOW, NOW);

    const emptyZip = createTestZip();
    const restoreResult = await executeRestore(emptyZip);
    expect(restoreResult.success).toBe(true);

    const postCounts = countAllTables();
    for (const { name } of TABLE_REGISTRY) {
      expect(postCounts[name]).toBe(0);
    }

    // Clean up
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });

  it('handles large row count (~100 rows across related tables)', async () => {
    const sqlite = getSqlite();
    const accountId = randomUUID();
    sqlite.prepare(`INSERT INTO accounts (id, name, is_active, created_at, updated_at)
      VALUES (?, 'Large Volume Account', 1, ?, ?)`).run(accountId, NOW, NOW);

    for (let i = 0; i < 100; i++) {
      const tradeId = randomUUID();
      const tradeCode = `LV-${String(i + 1).padStart(3, '0')}`;
      const direction = i % 2 === 0 ? 'long' : 'short';
      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'closed', ?, ?)`)
        .run(tradeId, tradeCode, accountId, `SYM${(i % 20) + 1}`, direction, NOW, NOW);
      sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, action, quantity, price, fees, executed_at, created_at)
        VALUES (?, ?, 'buy', 100, ?, 0.50, ?, ?)`)
        .run(randomUUID(), tradeId, 150 + Math.random() * 50, NOW, NOW);
      sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, action, quantity, price, fees, executed_at, created_at)
        VALUES (?, ?, 'sell', 100, ?, 0.50, ?, ?)`)
        .run(randomUUID(), tradeId, 160 + Math.random() * 50, NOW, NOW);
    }

    expect(countAllTables()['trades']).toBe(100);
    expect(countAllTables()['trade_executions']).toBe(200);

    const backupData = await serializeBackup(db);
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'));
    }

    const restoreResult = await executeRestore(zip.toBuffer());
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredRows).toBeGreaterThanOrEqual(300);

    expect(countAllTables()['trades']).toBe(100);
    expect(countAllTables()['trade_executions']).toBe(200);

    // Verify specific trade codes survived
    const sql = getSqlite();
    expect(sql.prepare("SELECT trade_code FROM trades WHERE trade_code = 'LV-001'").get()).toBeDefined();
    expect(sql.prepare("SELECT trade_code FROM trades WHERE trade_code = 'LV-050'").get()).toBeDefined();
    expect(sql.prepare("SELECT trade_code FROM trades WHERE trade_code = 'LV-100'").get()).toBeDefined();

    // Clean up
    rmSync(dirname(restoreResult.snapshotPath), { recursive: true, force: true });
  });
});
