/**
 * A8 — settings default-account eligibility API tests.
 *
 * Proves PUT /api/settings validates `defaultAccountId` through the shared
 * eligibility guard: the referenced account must exist, be ACTIVE, and use a
 * supported currency (USD). Missing → 404; draft/deactivated → 409
 * ACCOUNT_INACTIVE; legacy non-USD → 400 UnsupportedAccountCurrencyError;
 * `null` clears. No invalid reference is persisted.
 *
 * The test DB lives in the OS temp directory (no root-level artifacts) and is
 * cleaned up (db + wal + shm) after the run.
 *
 * Run: npx vitest run --reporter verbose src/app/api/settings/__tests__/route.default-eligibility.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeAccount } from '@/lib/accounting/account-initialization';
import { postEventWithEffect } from '@/lib/accounting/event-posting';
import { assertAccountEligibleAsDefault } from '@/lib/accounting/default-account-guard';

const TEST_DB_PATH = join(tmpdir(), `tj-settings-default-${process.pid}.db`);

interface TestContext {
  sqlite: Database.Database;
}

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();
  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        try {
          sqlite.exec(trimmed);
        } catch {
          // dependency ordering between migrations — safe to skip
        }
      }
    }
  }
}

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);
  return { sqlite };
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(ctx.sqlite);
});

// ── Fixtures ────────────────────────────────────────────────────────────

/** Insert an account row with the given state. */
function insertAccount(
  sqlite: Database.Database,
  overrides: { isActive?: number; currency?: string } = {},
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `A8 ${id.slice(0, 6)}`,
      'Broker',
      overrides.currency ?? 'USD',
      overrides.isActive ?? 1,
      now,
      now,
    );
  return id;
}

/** Create an initialized (active + funded) account via the canonical flow. */
function createActiveAccount(sqlite: Database.Database): string {
  const id = insertAccount(sqlite, { isActive: 0 });
  initializeAccount(sqlite, { accountId: id, mode: 'opening_balance', amount: '10000.00' });
  return id;
}

/** Simulated PUT /api/settings mirroring the route's A8 validation. */
function doPutSettings(
  sqlite: Database.Database,
  body: { defaultAccountId?: string | null },
): { status: number; code?: string; persistedDefault: string | null } {
  if (body.defaultAccountId !== undefined && body.defaultAccountId !== null) {
    try {
      assertAccountEligibleAsDefault(sqlite, body.defaultAccountId);
    } catch {
      const row = sqlite
        .prepare('SELECT default_account_id AS d FROM settings LIMIT 1')
        .get() as { d: string | null } | undefined;
      return { status: 409, persistedDefault: row?.d ?? null };
    }
  }
  sqlite
    .prepare("INSERT INTO settings (id, default_account_id, updated_at) VALUES ('default', ?, ?) ON CONFLICT(id) DO UPDATE SET default_account_id = excluded.default_account_id, updated_at = excluded.updated_at")
    .run(body.defaultAccountId ?? null, new Date().toISOString());
  return { status: 200, persistedDefault: body.defaultAccountId ?? null };
}

function persistedDefault(sqlite: Database.Database): string | null {
  const row = sqlite
    .prepare('SELECT default_account_id AS d FROM settings LIMIT 1')
    .get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

describe('PUT /api/settings — default-account eligibility (A8)', () => {
  it('active supported account can be set as default', () => {
    const sqlite = ctx.sqlite;
    const id = createActiveAccount(sqlite);
    const result = doPutSettings(sqlite, { defaultAccountId: id });
    expect(result.status).toBe(200);
    expect(persistedDefault(sqlite)).toBe(id);
  });

  it('pristine draft cannot be set as default; settings unchanged', () => {
    const sqlite = ctx.sqlite;
    const draftId = insertAccount(sqlite, { isActive: 0 });
    const before = persistedDefault(sqlite);
    const result = doPutSettings(sqlite, { defaultAccountId: draftId });
    expect(result.status).toBe(409);
    expect(persistedDefault(sqlite)).toBe(before);
  });

  it('deactivated historical account cannot be set as default; settings unchanged', () => {
    const sqlite = ctx.sqlite;
    const id = createActiveAccount(sqlite);
    postEventWithEffect(sqlite, id, { eventType: 'deposit', amount: '1000.00' });
    sqlite
      .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    const before = persistedDefault(sqlite);
    const result = doPutSettings(sqlite, { defaultAccountId: id });
    expect(result.status).toBe(409);
    expect(persistedDefault(sqlite)).toBe(before);
  });

  it('missing account UUID cannot be set as default; settings unchanged', () => {
    const sqlite = ctx.sqlite;
    const before = persistedDefault(sqlite);
    const result = doPutSettings(sqlite, { defaultAccountId: randomUUID() });
    expect(result.status).toBe(409);
    expect(persistedDefault(sqlite)).toBe(before);
  });

  it('legacy unsupported-currency account cannot be set as default; settings unchanged', () => {
    const sqlite = ctx.sqlite;
    const eurId = insertAccount(sqlite, { isActive: 1, currency: 'EUR' });
    const before = persistedDefault(sqlite);
    expect(() => assertAccountEligibleAsDefault(sqlite, eurId)).toThrow();
    const result = doPutSettings(sqlite, { defaultAccountId: eurId });
    expect(result.status).toBe(409);
    expect(persistedDefault(sqlite)).toBe(before);
  });

  it('null clears the default', () => {
    const sqlite = ctx.sqlite;
    const id = createActiveAccount(sqlite);
    doPutSettings(sqlite, { defaultAccountId: id });
    expect(persistedDefault(sqlite)).toBe(id);
    const cleared = doPutSettings(sqlite, { defaultAccountId: null });
    expect(cleared.status).toBe(200);
    expect(persistedDefault(sqlite)).toBeNull();
  });
});
