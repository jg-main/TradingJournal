/**
 * Route-level tests for the Account Overview API (GET)
 *
 * Tests the route logic by composing the same services the route handler
 * uses (findAccountPerformance, computeReconciliation, listAccountPositions,
 * listLatestValuationMarks, findInstrumentById, and the pure mapping
 * functions) against a real SQLite database with all migrations applied.
 *
 * Covers:
 * - Populated account with projection, positions, events, and reconciliation
 * - Empty account (no positions, no events, no projection)
 * - Missing-price scenario (positions exist but no valuation marks)
 * - Unknown account (404)
 * - Error response shapes conforming to project conventions
 *
 * Run: npx vitest run --reporter verbose src/app/api/accounts/\[id\]/overview/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Services and repository used by the route
import {
  accountExists,
  findAccountPerformance,
  listAccountPositions,
  listLatestValuationMarks,
  findInstrumentById,
  findOrCreateInstrument,
  insertValuationMark,
  insertFinancialEvent,
  insertLedgerEntry,
  insertLedgerPosting,
} from '@/db/accounting-repository';
import { computeReconciliation } from '@/lib/accounting/reconciliation';
import {
  composeOverviewSnapshot,
  deriveBannerState,
  mapPositionRow,
} from '@/lib/account-detail';
import { postExecutionFill } from '@/lib/accounting/execution-posting';
import { rebuildPositions } from '@/lib/positions/rebuild';
import type { CanonicalDecimal, EventType } from '@/lib/accounting/types';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = './.test-overview-route.db';

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
}

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  if (!existsSync(migrationsDir)) return;
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql.split('--> statement-breakpoint');
    for (const stmt of statements) {
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

function createTestDatabase(): TestContext {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
  // Clean up WAL/SHM files too
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, 'Overview Test Account', 'margin', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestDatabase(ctx: TestContext): void {
  try {
    ctx.sqlite.close();
  } catch {
    // ignore
  }
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }
}

// ── Simulated route logic ───────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates GET /api/accounts/:id/overview route handler logic without
 * Next.js dependencies. Uses the same services as the real route.
 */
function doGetAccountOverview(sqlite: Database.Database, accountId: string): RouteResult {
  try {
    // 1. Verify account exists
    if (!accountExists(sqlite, accountId)) {
      return { status: 404, body: { error: 'Account not found' } };
    }

    // 2. Overview Snapshot
    const projection = findAccountPerformance(sqlite, accountId);
    const snapshotInput = projection
      ? {
          netCash: projection.net_cash,
          nav: projection.nav,
          markedPositions: projection.marked_positions,
          realizedPnl: projection.realized_pnl,
          unrealizedPnl: projection.unrealized_pnl,
          totalPnl: projection.total_pnl,
          realizedFees: projection.realized_fees,
          grossExposure: projection.gross_exposure,
          netExposure: projection.net_exposure,
        }
      : {
          netCash: null as string | null,
          nav: null as string | null,
          markedPositions: null as string | null,
          realizedPnl: null as string | null,
          unrealizedPnl: null as string | null,
          totalPnl: null as string | null,
          realizedFees: null as string | null,
          grossExposure: null as string | null,
          netExposure: null as string | null,
        };

    const snapshot = composeOverviewSnapshot(snapshotInput);

    // 3. Reconciliation Banner
    let reconciliation: ReturnType<typeof deriveBannerState> | null = null;
    try {
      const report = computeReconciliation(sqlite, accountId);
      if (report) {
        reconciliation = deriveBannerState({
          cutoverEligible: report.cutoverEligible,
          cutoverRefusalReasons: report.cutoverRefusalReasons,
          comparisons: report.comparisons.length,
          matching: report.comparisons.filter((c: { classification: string }) => c.classification === 'match').length,
          explained: report.comparisons.filter((c: { classification: string }) => c.classification === 'explained').length,
          unexplained: report.comparisons.filter((c: { classification: string }) => c.classification === 'unexplained').length,
          computedAt: report.computedAt ?? null,
        });
      }
    } catch {
      // Best-effort
    }

    // 4. Positions Preview (up to 5)
    const allPositions = listAccountPositions(sqlite, accountId);
    const marks = listLatestValuationMarks(sqlite, accountId);

    const markCache = new Map<string, { markTimestamp: string; price: string }>();
    for (const m of marks) {
      markCache.set(m.instrument_id, { markTimestamp: m.mark_timestamp, price: m.price });
    }

    const instrumentCache = new Map<string, string>();
    function resolveSymbol(instrumentId: string): string {
      const cached = instrumentCache.get(instrumentId);
      if (cached) return cached;
      const instr = findInstrumentById(sqlite, instrumentId);
      const symbol = instr?.symbol ?? 'UNKNOWN';
      instrumentCache.set(instrumentId, symbol);
      return symbol;
    }

    const openPositions = allPositions
      .filter((p) => p.quantity !== '0.00' && p.direction !== null)
      .slice(0, 5)
      .map((p) => {
        const mark = markCache.get(p.instrument_id);
        return mapPositionRow({
          symbol: resolveSymbol(p.instrument_id),
          direction: p.direction,
          quantity: p.quantity,
          averageCost: p.average_cost,
          totalCostBasis: p.total_cost_basis,
          realizedGrossPnl: p.realized_gross_pnl,
          realizedNetPnl: p.realized_net_pnl,
          markTimestamp: mark?.markTimestamp ?? null,
          markPrice: mark?.price ?? null,
          markAgeMinutes: mark
            ? Math.floor(
                (Date.now() - new Date(mark.markTimestamp).getTime()) / 60_000,
              )
            : null,
        });
      });

    // 5. Recent Events Preview (up to 10)
    const eventRows = sqlite
      .prepare(
        `SELECT
           fe.id,
           fe.account_id,
           fe.event_type,
           fe.idempotency_key,
           fe.description,
           fe.payload,
           fe.effect,
           fe.posted_at,
           fe.created_at,
           le.id AS entry_id,
           COALESCE(
             (SELECT COUNT(*) FROM ledger_postings lp WHERE lp.ledger_entry_id = le.id),
             0
           ) AS posting_count,
           CASE
             WHEN le.id IS NULL THEN 0
             WHEN (
               COALESCE((SELECT SUM(lp2.amount_micros) FROM ledger_postings lp2 WHERE lp2.ledger_entry_id = le.id AND lp2.side = 'debit'), 0) =
               COALESCE((SELECT SUM(lp3.amount_micros) FROM ledger_postings lp3 WHERE lp3.ledger_entry_id = le.id AND lp3.side = 'credit'), 0)
             ) THEN 1
             ELSE 0
           END AS is_balanced
         FROM financial_events fe
         LEFT JOIN ledger_entries le ON le.financial_event_id = fe.id
         WHERE fe.account_id = ?
         ORDER BY fe.posted_at DESC, fe.id DESC
         LIMIT 10`,
      )
      .all(accountId) as Array<{
      id: string;
      account_id: string;
      event_type: string;
      idempotency_key: string | null;
      description: string | null;
      payload: string | null;
      effect: string | null;
      posted_at: string;
      created_at: string;
      entry_id: string | null;
      posting_count: number;
      is_balanced: number;
    }>;

    const eventsTotal = (
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
        .get(accountId) as { count: number }
    ).count;

    const events = eventRows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      description: row.description,
      postedAt: row.posted_at,
      status: {
        hasEntry: row.entry_id !== null,
        isBalanced: row.is_balanced === 1,
        postingCount: row.posting_count,
      },
    }));

    return {
      status: 200,
      body: {
        accountId,
        snapshot,
        reconciliation,
        positions: openPositions,
        positionsTotal: allPositions.filter((p) => p.quantity !== '0.00' && p.direction !== null).length,
        events,
        eventsTotal,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: 'Failed to fetch account overview',
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ── Helper to seed financial events ────────────────────────────────────

function seedFinancialEvent(
  sqlite: Database.Database,
  accountId: string,
  eventType: EventType,
  amount: string,
  description: string | null,
  postedAt: string,
): string {
  const event = insertFinancialEvent(sqlite, {
    accountId,
    eventType,
    description,
    postedAt,
  });

  // Create corresponding ledger entry
  const entry = insertLedgerEntry(sqlite, {
    financialEventId: event.id,
    accountId,
    description,
    postedAt,
  });

  // Create balanced postings
  const amountMicros = Math.round(parseFloat(amount) * 1_000_000);
  const cleanAmount = amount.replace(/^-/, '');
  insertLedgerPosting(sqlite, {
    ledgerEntryId: entry.id,
    accountId,
    side: parseFloat(amount) >= 0 ? 'debit' : 'credit',
    amount: cleanAmount as CanonicalDecimal,
    amountMicros: Math.abs(amountMicros),
    currency: 'USD',
    sequence: 1,
  });
  insertLedgerPosting(sqlite, {
    ledgerEntryId: entry.id,
    accountId,
    side: parseFloat(amount) >= 0 ? 'credit' : 'debit',
    amount: cleanAmount as CanonicalDecimal,
    amountMicros: Math.abs(amountMicros),
    currency: 'USD',
    sequence: 2,
  });

  return event.id;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('GET /api/accounts/[id]/overview — populated account', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
    const { sqlite, accountId } = ctx;

    // ── Seed performance projection ──
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions,
          realized_pnl, unrealized_pnl, total_pnl, realized_fees,
          gross_exposure, net_exposure, warnings, positions_json,
          rebuild_count, last_rebuilt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        now,
        '50000.00',
        '150000.00',
        '100000.00',
        '25000.00',
        '5000.00',
        '30000.00',
        '1500.00',
        '200000.00',
        '150000.00',
        '[]',
        '[]',
        1,
        now,
        now,
        now,
      );

    // ── Seed positions via execution fills ──
    // Buy 50 AAPL at 150.00
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
      price: '150.00',
      fees: '5.00',
    });
    // Buy 200 MSFT at 300.00
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'MSFT',
      action: 'buy',
      quantity: '200.00',
      price: '300.00',
      fees: '10.00',
    });
    rebuildPositions(sqlite, accountId);

    // ── Seed valuation mark for AAPL ──
    const aaplInstrument = findOrCreateInstrument(sqlite, 'AAPL');
    insertValuationMark(sqlite, {
      accountId,
      instrumentId: aaplInstrument.id,
      price: '165.00',
      priceMicros: 165_000_000,
      source: 'system',
      markTimestamp: now,
    });

    // MSFT intentionally gets no mark (missing-price scenario for that position)

    // ── Seed financial events ──
    seedFinancialEvent(sqlite, accountId, 'opening_balance', '100000.00', 'Opening balance', '2026-01-01T00:00:00.000Z');
    seedFinancialEvent(sqlite, accountId, 'deposit', '50000.00', 'Initial deposit', '2026-01-02T10:00:00.000Z');
    seedFinancialEvent(sqlite, accountId, 'dividend', '50.00', 'AAPL dividend', '2026-07-17T09:00:00.000Z');
    seedFinancialEvent(sqlite, accountId, 'fee', '-25.00', 'Monthly platform fee', '2026-07-18T00:00:00.000Z');
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('returns 200 with complete overview for populated account', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);
    expect(result.body.accountId).toBe(ctx.accountId);
  });

  it('includes snapshot with all 9 fields as strings', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const snapshot = result.body.snapshot as Record<string, unknown>;

    const overviewFields = [
      'netCash', 'nav', 'markedPositions', 'realizedPnl',
      'unrealizedPnl', 'totalPnl', 'realizedFees', 'grossExposure', 'netExposure',
    ];

    for (const field of overviewFields) {
      expect(typeof snapshot[field]).toBe('string');
      expect((snapshot[field] as string)).toMatch(/^-?\d+\.\d{2}$/);
    }

    // Verify specific values from seed
    expect(snapshot.netCash).toBe('50000.00');
    expect(snapshot.nav).toBe('150000.00');
    expect(snapshot.realizedPnl).toBe('25000.00');
  });

  it('includes reconciliation banner (may be null if no migration run)', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    // reconciliation may be null if no migration/comparison data exists
    expect(result.body).toHaveProperty('reconciliation');
  });

  it('includes positions preview with AAPL and MSFT', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const positions = result.body.positions as unknown[];
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length).toBeLessThanOrEqual(5);

    const symbols = (positions as Array<{ symbol: string }>).map((p) => p.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('MSFT');
  });

  it('AAPL position has fresh mark price and marked value', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const positions = result.body.positions as Array<Record<string, unknown>>;
    const aapl = positions.find((p) => p.symbol === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl!.markStatus).toBe('fresh');
    expect(aapl!.markPrice).toBe('165.00');
    expect(aapl!.markedValue).toBeDefined();
    expect(aapl!.unrealizedPnl).toBeDefined();
    // 50 * 165.00 = 8250.00
    expect(aapl!.markedValue).toBe('8250.00');
    // (165.00 - 150.00) * 50 = 750.00
    expect(aapl!.unrealizedPnl).toBe('750.00');
  });

  it('MSFT position has missing price status (no mark seeded)', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const positions = result.body.positions as Array<Record<string, unknown>>;
    const msft = positions.find((p) => p.symbol === 'MSFT');
    expect(msft).toBeDefined();
    expect(msft!.markStatus).toBe('missing');
    expect(msft!.markPrice).toBeNull();
    expect(msft!.markedValue).toBeNull();
    expect(msft!.unrealizedPnl).toBeNull();
  });

  it('returns positionsTotal count', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(typeof result.body.positionsTotal).toBe('number');
    expect(result.body.positionsTotal).toBeGreaterThan(0);
  });

  it('includes events preview with event count', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const events = result.body.events as unknown[];
    expect(events.length).toBeGreaterThan(0);
    expect(result.body.eventsTotal).toBeGreaterThan(0);
  });

  it('events are ordered newest first', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const events = result.body.events as Array<Record<string, unknown>>;
    for (let i = 1; i < events.length; i++) {
      const prevDate = new Date(events[i - 1].postedAt as string).getTime();
      const currDate = new Date(events[i].postedAt as string).getTime();
      expect(prevDate).toBeGreaterThanOrEqual(currDate);
    }
  });

  it('each event has id, eventType, description, postedAt, and status', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const events = result.body.events as Array<Record<string, unknown>>;
    for (const ev of events) {
      expect(typeof ev.id).toBe('string');
      expect(typeof ev.eventType).toBe('string');
      expect(typeof ev.postedAt).toBe('string');

      const status = ev.status as Record<string, unknown>;
      expect(typeof status.hasEntry).toBe('boolean');
      expect(typeof status.isBalanced).toBe('boolean');
      expect(typeof status.postingCount).toBe('number');
    }
  });
});

describe('GET /api/accounts/[id]/overview — empty account', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
    // No positions, no events, no projection seeded
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('returns 200 with all-null snapshot', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(result.status).toBe(200);
    const snapshot = result.body.snapshot as Record<string, unknown>;
    const overviewFields = [
      'netCash', 'nav', 'markedPositions', 'realizedPnl',
      'unrealizedPnl', 'totalPnl', 'realizedFees', 'grossExposure', 'netExposure',
    ];
    for (const field of overviewFields) {
      expect(snapshot[field]).toBeNull();
    }
  });

  it('returns empty positions array with positionsTotal=0', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(Array.isArray(result.body.positions)).toBe(true);
    expect((result.body.positions as unknown[]).length).toBe(0);
    expect(result.body.positionsTotal).toBe(0);
  });

  it('returns empty events array with eventsTotal=0', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(Array.isArray(result.body.events)).toBe(true);
    expect((result.body.events as unknown[]).length).toBe(0);
    expect(result.body.eventsTotal).toBe(0);
  });

  it('returns null reconciliation (no run data)', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(result.body.reconciliation).toBeNull();
  });
});

describe('GET /api/accounts/[id]/overview — unknown account', () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    // Use a clean database with no accounts
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }

    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
  });

  afterAll(() => {
    sqlite.close();
    try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }
  });

  it('returns 404 for non-existent account', () => {
    const fakeId = randomUUID();
    const result = doGetAccountOverview(sqlite, fakeId);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Account not found');
    expect('details' in result.body).toBe(false);
  });
});

describe('GET /api/accounts/[id]/overview — error response shapes', () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }

    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);
  });

  afterAll(() => {
    sqlite.close();
    try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-journal'); } catch { /* ok */ }
  });

  it('404 error has string error field, no details key', () => {
    const fakeId = randomUUID();
    const result = doGetAccountOverview(sqlite, fakeId);
    expect(result.body.error).toBeTypeOf('string');
    expect('details' in result.body).toBe(false);
  });

  it('500 error has error string and details string', () => {
    // Simulate server error by passing an invalid sqlite handle
    const badHandle = {} as Database.Database;
    const result = doGetAccountOverview(badHandle, 'invalid');
    expect(result.status).toBe(500);
    expect(result.body.error).toBeTypeOf('string');
    expect(result.body.details).toBeTypeOf('string');
  });
});

describe('GET /api/accounts/[id]/overview — response contract shape', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestDatabase();
    const { sqlite, accountId } = ctx;

    // Seed at least one position and one event for shape verification
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions,
          realized_pnl, unrealized_pnl, total_pnl, realized_fees,
          gross_exposure, net_exposure, warnings, positions_json,
          rebuild_count, last_rebuilt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        now,
        '50000.00',
        '150000.00',
        '100000.00',
        '25000.00',
        '5000.00',
        '30000.00',
        '1500.00',
        '200000.00',
        '150000.00',
        '[]',
        '[]',
        1,
        now,
        now,
        now,
      );

    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
      price: '150.00',
      fees: '5.00',
    });
    rebuildPositions(sqlite, accountId);

    seedFinancialEvent(sqlite, accountId, 'opening_balance', '100000.00', 'Opening balance', '2026-01-01T00:00:00.000Z');
  });

  afterAll(() => {
    destroyTestDatabase(ctx);
  });

  it('has all top-level response fields', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(result.body).toHaveProperty('accountId');
    expect(result.body).toHaveProperty('snapshot');
    expect(result.body).toHaveProperty('reconciliation');
    expect(result.body).toHaveProperty('positions');
    expect(result.body).toHaveProperty('positionsTotal');
    expect(result.body).toHaveProperty('events');
    expect(result.body).toHaveProperty('eventsTotal');
  });

  it('snapshot contains only the 9 overview fields (no excluded fields)', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const snapshot = result.body.snapshot as Record<string, unknown>;
    const snapshotKeys = Object.keys(snapshot);
    expect(snapshotKeys).toEqual(expect.arrayContaining([
      'netCash', 'nav', 'markedPositions', 'realizedPnl',
      'unrealizedPnl', 'totalPnl', 'realizedFees', 'grossExposure', 'netExposure',
    ]));
    // Should NOT contain reconciliation-confined fields
    expect(snapshotKeys).not.toContain('twr');
    expect(snapshotKeys).not.toContain('highWaterMark');
    expect(snapshotKeys).not.toContain('drawdown');
    expect(snapshotKeys).not.toContain('drawdownPct');
    expect(snapshotKeys).not.toContain('modifiedDietzReturn');
  });

  it('positions array items have required fields', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    const positions = result.body.positions as Array<Record<string, unknown>>;
    for (const pos of positions) {
      expect(typeof pos.symbol).toBe('string');
      expect(typeof pos.quantity).toBe('string');
      expect(typeof pos.averageCost).toBe('string');
      expect(typeof pos.totalCostBasis).toBe('string');
      expect(typeof pos.realizedGrossPnl).toBe('string');
      expect(typeof pos.realizedNetPnl).toBe('string');
      expect(['fresh', 'stale', 'missing', 'pending']).toContain(pos.markStatus);
    }
  });

  it('positionsTotal is a number', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(typeof result.body.positionsTotal).toBe('number');
  });

  it('eventsTotal is a number', () => {
    const result = doGetAccountOverview(ctx.sqlite, ctx.accountId);
    expect(typeof result.body.eventsTotal).toBe('number');
  });
});
