/**
 * M007-S01 (D1) — account activity reconstructs execution effects with the
 * canonical economic-action boundary.
 *
 * A short add must reconstruct as cash INCREASE (economically sell_short) and
 * a short reduce as cash DECREASE (economically buy_to_cover) — even when the
 * stored effect is a legacy '#skip#' placeholder or an earlier row whose
 * direction was recorded incorrectly. The reconstruction resolves journal
 * aliases through the trade direction (via the event's deterministic
 * accounting-execution-<id> key).
 *
 * Run: npx vitest run src/lib/accounting/__tests__/activity-economic-direction.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbPath } from '../../testing/test-db';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { postExecutionFill } from '../execution-posting';
import { postFinancialEvent } from '../posting';
import { computeAccountActivity } from '../activity';
import { findOrCreateInstrument, insertAccountingExecution } from '../../../db/accounting-repository';
import { executionFinancialEventIdempotencyKey } from '../execution-posting';

const TEST_DB_PATH = testDbPath('activity-economic-direction');

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  if (!existsSync(migrationsDir)) return;
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
          // skip
        }
      }
    }
  }
}

describe('M007-S01 activity economic direction', () => {
  let sqlite: Database.Database;
  let accountId: string;
  let symbol: string;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);

    accountId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
         VALUES (?, 'Activity Direction', 'USD', 1, 0.0, ?, ?)`,
      )
      .run(accountId, now, now);
    symbol = 'AAPL';
    findOrCreateInstrument(sqlite, symbol);
  });

  afterAll(() => {
    try {
      if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
      for (const ext of ['-wal', '-shm']) {
        const path = TEST_DB_PATH + ext;
        if (existsSync(path)) unlinkSync(path);
      }
    } catch {
      // ignore
    }
  });

  function seedShortTrade(): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'short', 'open', ?, ?)`,
      )
      .run(id, `T-${randomUUID().slice(0, 8)}`, accountId, symbol, now, now);
    return id;
  }

  function effectOf(eventId: string): { direction?: string } {
    const activity = computeAccountActivity(sqlite, accountId);
    const event = activity.events.find((e) => e.eventId === eventId);
    return (event?.effect ?? {}) as { direction?: string };
  }

  /**
   * Insert a legacy-style trade_execution event: an accounting execution
   * linked to a trade (direction short) whose financial event carries a
   * '#skip#' effect placeholder and the JOURNAL ALIAS vocabulary in its
   * payload (exactly what early migration produced). Raw inserts bypass the
   * immutability triggers, mirroring legacy data creation.
   */
  function insertLegacyAliasEvent(
    tradeId: string,
    aliasAction: string,
    quantity: string,
    price: string,
  ): string {
    const instrumentId = (
      sqlite.prepare('SELECT id FROM instruments WHERE symbol = ?').get(symbol) as { id: string }
    ).id;
    const now = new Date().toISOString();
    insertAccountingExecution(sqlite, {
      accountId,
      instrumentId,
      action: aliasAction, // legacy rows carried the alias in accounting too
      quantity,
      price,
      fees: '0.00',
      idempotencyKey: null,
      journalTradeId: tradeId,
      description: `Legacy ${aliasAction}`,
      postedAt: now,
    });

    // The deterministic financial-event key references the REAL accounting
    // execution id (the insert generates it internally).
    const executionId = (
      sqlite
        .prepare('SELECT id FROM accounting_executions WHERE description = ? ORDER BY created_at DESC LIMIT 1')
        .get(`Legacy ${aliasAction}`) as { id: string }
    ).id;

    const eventId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO financial_events (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
         VALUES (?, ?, 'trade_execution', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        accountId,
        executionFinancialEventIdempotencyKey(executionId),
        `Legacy ${aliasAction}`,
        JSON.stringify({ action: aliasAction, symbol, quantity, price, fees: '0.00' }),
        JSON.stringify({ kind: 'cash', direction: '#skip#' }),
        now,
        now,
      );
    return eventId;
  }

  it('short add event reconstructs as cash increase (economically sell_short)', () => {
    const tradeId = seedShortTrade();
    const eventId = insertLegacyAliasEvent(tradeId, 'add', '100.00', '50.00');

    // Short add = economically sell_short → cash INCREASE, derived from the
    // payload alias + trade direction, never from the '#skip#' placeholder.
    expect(effectOf(eventId).direction).toBe('increase');
  });

  it('short reduce event reconstructs as cash decrease (economically buy_to_cover)', () => {
    const tradeId = seedShortTrade();
    const eventId = insertLegacyAliasEvent(tradeId, 'reduce', '30.00', '45.00');

    // Short reduce = economically buy_to_cover → cash DECREASE.
    expect(effectOf(eventId).direction).toBe('decrease');
  });

  it('concrete actions keep canonical direction without direction resolution', () => {
    const tradeId = seedShortTrade();

    const short = postExecutionFill(sqlite, {
      accountId,
      symbol,
      action: 'sell_short',
      quantity: '10.00',
      price: '50.00',
      fees: '0.00',
      journalTradeId: tradeId,
    });
    expect(effectOf(short.eventWithPostings.event.id).direction).toBe('increase');

    const cover = postExecutionFill(sqlite, {
      accountId,
      symbol,
      action: 'buy_to_cover',
      quantity: '10.00',
      price: '45.00',
      fees: '0.00',
      journalTradeId: tradeId,
    });
    expect(effectOf(cover.eventWithPostings.event.id).direction).toBe('decrease');
  });
});
