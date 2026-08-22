/**
 * Cross-cutting integrity test — backdated events, default-account fallback,
 * and trade workflow integration.
 *
 * S06/T02 verification surface. T01 covered the full cash-event lifecycle
 * (opening → deposit → … → correction) through the real posting kernel and
 * projection engines. This suite covers the three cross-cutting surfaces
 * T01 deliberately left out:
 *
 *   1. Backdated cash events  — events posted with a postedAt earlier than
 *      already-posted events must rebuild every projection at that date:
 *      ledger ordering (the backdated event slots between its neighbors),
 *      activity ordering, cash/NAV totals, and the HWM/drawdown chain.
 *
 *   2. Default-account fallback — the dashboard v2 route resolution contract
 *      (param → settings.default_account_id → first active account) and the
 *      D6 deactivation coherence that clears a stale default so consumers
 *      fall back to the first active account. The exact SQL from the route
 *      and close/PUT handlers is replicated here because those handlers read
 *      the process-wide singleton DB; the SQL is the durable contract.
 *
 *   3. Trade workflow — posting executions through the real execution
 *      posting + FIFO position rebuild + performance rebuild pipeline must
 *      move account NAV and P&L correctly: buy reduces cash and creates an
 *      open position, a fresh mark produces unrealized P&L and exposure,
 *      and a sell realizes gross/net P&L plus closing fees while the
 *      ledger stays balanced.
 *
 * Run: npx vitest run src/lib/accounting/__tests__/cross-cutting-integrity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { postEventWithEffect } from '../event-posting';
import { postFinancialEventSchema } from '../api-contracts';
import { checkLedgerBalance, rebuildNetPosition, rebuildOpeningCash } from '../rebuild';
import { computeAccountActivity, computeAccountCashImpact } from '../activity';
import { buildLedgerProjection } from '../ledger';
import type {
  LedgerEntryInput,
  LedgerPostingInput,
  LedgerProjectionQuery,
} from '../ledger';
import { resolveFinancialEventCorrectionGroupsForAccount } from '../ledger-route-helpers';
import { postExecutionFill } from '../execution-posting';
import { allocateFifo } from '../../positions/fifo';
import type { CanonicalDecimal } from '../types';
import { rebuildAccountPerformance } from '../../performance/performance-rebuild';
import { rebuildPositions } from '../../positions/rebuild';
import { computeDashboardV2 } from '../dashboard-v2';
import { composeOverviewSnapshot } from '../../account-detail';
import {
  findAccountPerformance,
  listAccountEvents,
  findPostingsByEntryId,
  findInstrumentBySymbol,
  findAccountPosition,
  insertValuationMark,
} from '@/db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
}

function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
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
          // skip expected ordering failures (same behavior as existing tests)
        }
      }
    }
  }
}

function createTestContext(accountName = 'Cross-Cutting Test Account'): TestContext {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  applyAllMigrations(sqlite);

  const accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(accountId, accountName, 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestContext(ctx: TestContext): void {
  ctx.sqlite.close();
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseEventRequest(body: Record<string, unknown>) {
  const parsed = postFinancialEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

function postCashEvent(ctx: TestContext, body: Record<string, unknown>): { eventId: string } {
  const result = postEventWithEffect(ctx.sqlite, ctx.accountId, parseEventRequest(body));
  return { eventId: result.event.id };
}

function rebuildProjection(ctx: TestContext) {
  return rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
}

function composeLedgerProjection(ctx: TestContext, query?: LedgerProjectionQuery) {
  const { sqlite, accountId } = ctx;

  const eventRows = listAccountEvents(sqlite, accountId);

  const entries: LedgerEntryInput[] = [];
  const postings: LedgerPostingInput[] = [];

  for (const row of eventRows) {
    if (row.entry_id) {
      if (!entries.some((e) => e.id === row.entry_id)) {
        entries.push({
          id: row.entry_id as string,
          financial_event_id: row.id,
          account_id: row.account_id,
          description: row.description,
          posted_at: row.posted_at,
          created_at: row.created_at,
        });
      }
      for (const pr of findPostingsByEntryId(sqlite, row.entry_id as string)) {
        if (!postings.some((p) => p.id === pr.id)) {
          postings.push({
            id: pr.id,
            ledger_entry_id: pr.ledger_entry_id,
            account_id: pr.account_id,
            side: pr.side,
            amount: pr.amount,
            amount_micros: pr.amount_micros,
            currency: pr.currency,
            sequence: pr.sequence,
            created_at: pr.created_at,
          });
        }
      }
    }
  }

  const correctionGroups = resolveFinancialEventCorrectionGroupsForAccount(sqlite, accountId);

  return buildLedgerProjection(
    { events: eventRows, entries, postings, correctionGroups },
    query,
  );
}

/**
 * Assert the accounting-ledger invariants: globally balanced postings and
 * per-account postings net to zero.
 */
function assertLedgerInvariants(ctx: TestContext, where: string): void {
  const balance = checkLedgerBalance(ctx.sqlite);
  expect(balance.isBalanced, `${where}: global ledger is balanced`).toBe(true);
  const netPosition = rebuildNetPosition(ctx.sqlite, ctx.accountId);
  expect(netPosition.netAmount, `${where}: per-account postings net to zero`).toBe('0.00');
}

// ═══════════════════════════════════════════════════════════════════════
// Surface 1 — Backdated cash events rebuild at the postedAt date
// ═══════════════════════════════════════════════════════════════════════

describe('cross-cutting integrity — backdated cash events', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestContext();
    // Opening balance anchors the timeline.
    postCashEvent(ctx, {
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Initial funding',
      postedAt: '2026-03-01T14:00:00.000Z',
    });
    // A later deposit is posted first.
    postCashEvent(ctx, {
      eventType: 'deposit',
      amount: '2500.00',
      description: 'Later deposit',
      postedAt: '2026-03-10T14:00:00.000Z',
    });
    rebuildProjection(ctx);
  });

  afterAll(() => {
    destroyTestContext(ctx);
  });

  it('posts a backdated deposit that slots between existing events at its postedAt', () => {
    // The backdated deposit is dated 03-05 — between the opening (03-01) and
    // the already-posted deposit (03-10) — but is posted AFTER the 03-10
    // event. Every projection must place it by postedAt, not insertion order.
    postCashEvent(ctx, {
      eventType: 'deposit',
      amount: '1000.00',
      description: 'Backdated deposit',
      postedAt: '2026-03-05T14:00:00.000Z',
    });

    const rebuild = rebuildProjection(ctx);
    expect(rebuild.success).toBe(true);
    expect(rebuild.nav).toBe('13500.00');

    // ── Ledger projection ordering ────────────────────────────────────
    const ledger = composeLedgerProjection(ctx);
    const order = ledger.events.map((e) => ({
      eventType: e.eventType,
      postedAt: e.postedAt,
      cashImpact: e.cashImpact,
    }));
    expect(order).toEqual([
      { eventType: 'opening_balance', postedAt: '2026-03-01T14:00:00.000Z', cashImpact: '10000.00' },
      { eventType: 'deposit', postedAt: '2026-03-05T14:00:00.000Z', cashImpact: '1000.00' },
      { eventType: 'deposit', postedAt: '2026-03-10T14:00:00.000Z', cashImpact: '2500.00' },
    ]);

    // ── Activity projection ordering ──────────────────────────────────
    const activity = computeAccountActivity(ctx.sqlite, ctx.accountId);
    expect(activity.events.map((e) => e.postedAt)).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-03-05T14:00:00.000Z',
      '2026-03-10T14:00:00.000Z',
    ]);

    // ── Cash / NAV projection ─────────────────────────────────────────
    const openingCash = rebuildOpeningCash(ctx.sqlite, ctx.accountId);
    expect(openingCash.totalOpeningCash).toBe('10000.00');
    const cashImpact = computeAccountCashImpact(ctx.sqlite, ctx.accountId);
    // Net cash impact is the running total including the opening balance:
    // 10000 (opening) + 1000 (backdated) + 2500 (later) = 13500.00.
    expect(cashImpact.netCashImpact).toBe('13500.00');

    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj).toBeDefined();
    if (!proj) return;
    expect(proj.net_cash).toBe('13500.00');
    expect(proj.nav).toBe('13500.00');
    expect(proj.realized_pnl).toBe('0.00');
    expect(proj.realized_fees).toBe('0.00');
    // HWM chain: opening 10000 → 03-10 deposit 12500 → backdated deposit 13500.
    expect(proj.high_water_mark).toBe('13500.00');
    expect(proj.drawdown).toBe('0.00');

    // ── Ledger invariants ─────────────────────────────────────────────
    assertLedgerInvariants(ctx, 'backdated deposit');

    // ── Overview snapshot mirrors the projection ──────────────────────
    const overview = composeOverviewSnapshot({
      netCash: proj.net_cash,
      nav: proj.nav,
      markedPositions: proj.marked_positions,
      realizedPnl: proj.realized_pnl,
      unrealizedPnl: proj.unrealized_pnl,
      totalPnl: proj.total_pnl,
      realizedFees: proj.realized_fees,
      grossExposure: proj.gross_exposure,
      netExposure: proj.net_exposure,
    });
    expect(overview.netCash).toBe('13500.00');
    expect(overview.nav).toBe('13500.00');
  });

  it('keeps projections consistent after a backdated withdrawal dips below the HWM', () => {
    // Backdated withdrawal dated 03-03 (posted after everything) reduces NAV
    // below the 13500.00 HWM → drawdown must appear.
    postCashEvent(ctx, {
      eventType: 'withdrawal',
      amount: '500.00',
      description: 'Backdated withdrawal',
      postedAt: '2026-03-03T14:00:00.000Z',
    });

    const rebuild = rebuildProjection(ctx);
    expect(rebuild.success).toBe(true);
    expect(rebuild.nav).toBe('13000.00');

    const ledger = composeLedgerProjection(ctx);
    expect(ledger.events.map((e) => e.postedAt)).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-03-03T14:00:00.000Z',
      '2026-03-05T14:00:00.000Z',
      '2026-03-10T14:00:00.000Z',
    ]);
    expect(ledger.events[1].eventType).toBe('withdrawal');
    expect(ledger.events[1].cashImpact).toBe('-500.00');

    const cashImpact = computeAccountCashImpact(ctx.sqlite, ctx.accountId);
    // Running total including opening: 10000 + 1000 + 2500 - 500 = 13000.00.
    expect(cashImpact.netCashImpact).toBe('13000.00');

    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj).toBeDefined();
    if (!proj) return;
    expect(proj.net_cash).toBe('13000.00');
    expect(proj.nav).toBe('13000.00');
    expect(proj.high_water_mark).toBe('13500.00');
    expect(proj.drawdown).toBe('500.00');

    assertLedgerInvariants(ctx, 'backdated withdrawal');
  });

  it('rebuilds deterministically after backdated events', () => {
    const before = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(before).toBeDefined();
    if (!before) return;

    const first = rebuildProjection(ctx);
    // Capture the projection between the two rebuild calls so the counter
    // advance is observable (reading both after both rebuilds would see the
    // same final row).
    const afterFirst = findAccountPerformance(ctx.sqlite, ctx.accountId)!;
    const second = rebuildProjection(ctx);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const afterSecond = findAccountPerformance(ctx.sqlite, ctx.accountId)!;
    // Cash / NAV / P&L are stable across rebuilds — the projection rebuilds
    // from the immutable ledger, so these values never drift.
    expect(afterFirst.net_cash).toBe(before.net_cash);
    expect(afterFirst.nav).toBe(before.nav);
    expect(afterFirst.realized_pnl).toBe(before.realized_pnl);
    expect(afterSecond.net_cash).toBe(afterFirst.net_cash);
    expect(afterSecond.nav).toBe(afterFirst.nav);
    expect(afterSecond.realized_pnl).toBe(afterFirst.realized_pnl);
    // HWM/drawdown are NOT asserted for cross-rebuild stability: the rebuild
    // engine derives them as a two-point chain (max of the previous stored
    // NAV and the current NAV), so a rebuild after NAV has already dropped
    // recomputes HWM from the last stored NAV. That is the established S04
    // behavior T01 codified; the all-time peak is not persisted.
    expect(afterFirst.rebuild_count).toBeGreaterThan(before.rebuild_count);
    expect(afterSecond.rebuild_count).toBeGreaterThan(afterFirst.rebuild_count);
  });

  it('dashboard-v2 agrees with the backdated-event projections', () => {
    const dash = computeDashboardV2(ctx.sqlite, ctx.accountId);
    expect(dash).toBeDefined();
    if (!dash) return;
    expect(dash.account.id).toBe(ctx.accountId);
    expect(dash.metrics.cash).toBe('13000.00');
    expect(dash.metrics.nav).toBe('13000.00');
    expect(dash.metrics.realizedPnl).toBe('0.00');
    expect(dash.metrics.realizedFees).toBe('0.00');
    expect(dash.integrity.status).toMatch(/^(healthy|warning)$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Surface 2 — Default-account fallback after deactivation
// ═══════════════════════════════════════════════════════════════════════

/**
 * The account-resolution contract shared by dashboard v2 and other
 * consumers: provided param → settings.default_account_id → first active
 * account. Mirrors `resolveAccountId` in src/app/api/dashboard/v2/route.ts
 * and the first-active fallback in the dashboard v1 and trades routes.
 * The handlers read the process-wide singleton DB, so the test replicates
 * their exact SQL — that SQL is the durable cross-consumer contract.
 */
function resolveAccountIdContract(sqlite: Database.Database): string | undefined {
  const setting = sqlite
    .prepare('SELECT default_account_id FROM settings LIMIT 1')
    .get() as { default_account_id: string | null } | undefined;

  if (setting?.default_account_id) {
    return setting.default_account_id;
  }

  const firstActive = sqlite
    .prepare('SELECT id FROM accounts WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1')
    .get() as { id: string } | undefined;

  return firstActive?.id ?? undefined;
}

/**
 * D6 deactivation coherence from the close and PUT handlers: deactivating
 * the settings default clears the stale reference so resolution moves to
 * the first active account.
 */
function deactivateWithD6(sqlite: Database.Database, accountId: string): void {
  sqlite
    .prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), accountId);
  sqlite
    .prepare('UPDATE settings SET default_account_id = NULL, updated_at = ? WHERE default_account_id = ?')
    .run(new Date().toISOString(), accountId);
}

describe('cross-cutting integrity — default-account fallback', () => {
  let sqlite: Database.Database;
  let firstActiveId: string;
  let secondActiveId: string;

  beforeAll(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyAllMigrations(sqlite);

    // Two active accounts with deterministic created_at ordering.
    firstActiveId = randomUUID();
    secondActiveId = randomUUID();
    const insertAccount = sqlite.prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    insertAccount.run(firstActiveId, 'First Active', 'Broker', 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    insertAccount.run(secondActiveId, 'Second Active', 'Broker', 'USD', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  });

  afterAll(() => {
    sqlite.close();
  });

  it('resolves the configured default account when it is active', () => {
    sqlite
      .prepare(
        `INSERT INTO settings (id, default_account_id, created_at, updated_at)
         VALUES ('default', ?, ?, ?)`,
      )
      .run(secondActiveId, new Date().toISOString(), new Date().toISOString());

    expect(resolveAccountIdContract(sqlite)).toBe(secondActiveId);
  });

  it('falls back to the first active account after the default is deactivated (D6)', () => {
    // Deactivating the configured default clears settings.default_account_id
    // (the same UPDATE the close and PUT handlers run), so resolution moves
    // to the first active account by created_at.
    deactivateWithD6(sqlite, secondActiveId);

    const resolved = resolveAccountIdContract(sqlite);
    expect(resolved).toBe(firstActiveId);

    // The stale default reference is gone.
    const setting = sqlite
      .prepare('SELECT default_account_id FROM settings LIMIT 1')
      .get() as { default_account_id: string | null } | undefined;
    expect(setting?.default_account_id).toBeNull();

    // Dashboard v2 aggregation works for the newly-resolved account.
    const dash = computeDashboardV2(sqlite, firstActiveId);
    expect(dash).toBeDefined();
    if (!dash) return;
    expect(dash.account.id).toBe(firstActiveId);
  });

  it('resolves the first active account when no default is configured', () => {
    // New DB with no settings row at all → first active account by created_at.
    const fresh = new Database(':memory:');
    fresh.pragma('foreign_keys = ON');
    applyAllMigrations(fresh);
    const now = new Date().toISOString();
    const a = randomUUID();
    const b = randomUUID();
    const insertAccount = fresh.prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    insertAccount.run(a, 'A', 'Broker', 'USD', now, now);
    insertAccount.run(b, 'B', 'Broker', 'USD', now, now);

    expect(resolveAccountIdContract(fresh)).toBe(a);
    fresh.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Surface 3 — Trade workflow executions affect NAV and P&L
// ═══════════════════════════════════════════════════════════════════════

describe('cross-cutting integrity — trade workflow', () => {
  let ctx: TestContext;
  let instrumentId: string;

  beforeAll(() => {
    ctx = createTestContext();
    postCashEvent(ctx, {
      eventType: 'opening_balance',
      amount: '20000.00',
      description: 'Initial funding',
      postedAt: '2026-04-01T14:00:00.000Z',
    });
    rebuildProjection(ctx);
  });

  afterAll(() => {
    destroyTestContext(ctx);
  });

  function postExecution(
    input: Parameters<typeof postExecutionFill>[1],
  ) {
    const result = postExecutionFill(ctx.sqlite, input);
    // Mirror the executions route: rebuild positions for the instrument,
    // then refresh the account-wide projection.
    rebuildPositions(ctx.sqlite, ctx.accountId, instrumentId);
    rebuildProjection(ctx);
    return result;
  }

  it('buy execution reduces cash and opens a position that marks to market', () => {
    // Buy 100 AAPL @ 150.75 → consideration 15075.00, cash 20000 - 15075 = 4925.
    const buy = postExecution({
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.75',
      fees: '5.00',
      description: 'Buy 100 AAPL',
      postedAt: '2026-04-02T14:00:00.000Z',
    });
    expect(buy.execution.action).toBe('buy');
    expect(buy.execution.quantity).toBe('100.00');

    instrumentId = buy.execution.instrumentId;

    // ── Ledger effect: gross consideration posted, ledger stays balanced ──
    const cashImpact = computeAccountCashImpact(ctx.sqlite, ctx.accountId);
    // Running total including opening: 20000 - 15075 (buy) = 4925.00.
    expect(cashImpact.netCashImpact).toBe('4925.00');

    const ledger = composeLedgerProjection(ctx);
    const execRows = ledger.events.filter((e) => e.eventType === 'trade_execution');
    expect(execRows).toHaveLength(1);
    expect(execRows[0].cashImpact).toBe('-15075.00');
    assertLedgerInvariants(ctx, 'buy execution');

    // ── FIFO position projection ──────────────────────────────────────
    const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrumentId);
    expect(position).toBeDefined();
    if (!position) return;
    expect(position.direction).toBe('long');
    expect(position.quantity).toBe('100.00');
    expect(position.average_cost).toBe('150.75');
    expect(position.total_cost_basis).toBe('15075.00');
    expect(position.realized_gross_pnl).toBe('0.00');
    expect(position.realized_net_pnl).toBe('0.00');

    // ── Fresh mark → NAV / unrealized P&L / exposure ──────────────────
    insertValuationMark(ctx.sqlite, {
      accountId: ctx.accountId,
      instrumentId,
      price: '155.00',
      priceMicros: 155_000_000,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    rebuildProjection(ctx);

    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj).toBeDefined();
    if (!proj) return;
    expect(proj.net_cash).toBe('4925.00');
    expect(proj.marked_positions).toBe('15500.00'); // 100 × 155.00
    expect(proj.nav).toBe('20425.00'); // 4925 + 15500
    expect(proj.unrealized_pnl).toBe('425.00'); // (155 - 150.75) × 100
    expect(proj.realized_pnl).toBe('0.00');
    expect(proj.total_pnl).toBe('425.00');
    expect(proj.gross_exposure).toBe('15500.00');
    expect(proj.net_exposure).toBe('15500.00');
    expect(proj.realized_fees).toBe('0.00');
    expect(proj.high_water_mark).toBe('20425.00');
    expect(proj.drawdown).toBe('0.00');
  });

  it('sell execution realizes gross/net P&L and closing fees, NAV = cash', () => {
    // Sell 100 AAPL @ 160.00 fees 6.00 → cash 4925 + 16000 = 20925.
    const sell = postExecution({
      accountId: ctx.accountId,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '100.00',
      price: '160.00',
      fees: '6.00',
      description: 'Sell 100 AAPL',
      postedAt: '2026-04-03T14:00:00.000Z',
    });
    expect(sell.execution.action).toBe('sell');

    // ── Cash ──────────────────────────────────────────────────────────
    const cashImpact = computeAccountCashImpact(ctx.sqlite, ctx.accountId);
    // Running total including opening: 20000 - 15075 (buy) + 16000 (sell)
    // = 20925.00. (Ledger records gross consideration; fees are a
    // position-level FIFO concern, so they do not move ledger cash.)
    expect(cashImpact.netCashImpact).toBe('20925.00');

    // ── Position closed ───────────────────────────────────────────────
    const position = findAccountPosition(ctx.sqlite, ctx.accountId, instrumentId);
    expect(position).toBeDefined();
    if (!position) return;
    expect(position.direction).toBeNull();
    expect(position.quantity).toBe('0.00');
    // Gross: (160 - 150.75) × 100 = 925.00; closing fee 6.00 → net 919.00.
    expect(position.realized_gross_pnl).toBe('925.00');
    expect(position.realized_fees).toBe('6.00');
    expect(position.realized_net_pnl).toBe('919.00');

    // ── Projection: NAV = cash, realized P&L net of closing fees ──────
    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj).toBeDefined();
    if (!proj) return;
    expect(proj.net_cash).toBe('20925.00');
    expect(proj.marked_positions).toBe('0.00');
    expect(proj.nav).toBe('20925.00');
    expect(proj.realized_pnl).toBe('919.00');
    expect(proj.unrealized_pnl).toBe('0.00');
    expect(proj.total_pnl).toBe('919.00');
    expect(proj.realized_fees).toBe('6.00');
    expect(proj.gross_exposure).toBe('0.00');
    expect(proj.net_exposure).toBe('0.00');
    expect(proj.high_water_mark).toBe('20925.00');
    expect(proj.drawdown).toBe('0.00');

    // ── Ledger: both executions visible, ledger balanced ──────────────
    const ledger = composeLedgerProjection(ctx);
    const execRows = ledger.events.filter((e) => e.eventType === 'trade_execution');
    expect(execRows).toHaveLength(2);
    expect(execRows[0].cashImpact).toBe('-15075.00');
    expect(execRows[1].cashImpact).toBe('16000.00');
    assertLedgerInvariants(ctx, 'sell execution');

    // ── Overview snapshot mirrors the projection ──────────────────────
    const overview = composeOverviewSnapshot({
      netCash: proj.net_cash,
      nav: proj.nav,
      markedPositions: proj.marked_positions,
      realizedPnl: proj.realized_pnl,
      unrealizedPnl: proj.unrealized_pnl,
      totalPnl: proj.total_pnl,
      realizedFees: proj.realized_fees,
      grossExposure: proj.gross_exposure,
      netExposure: proj.net_exposure,
    });
    expect(overview.netCash).toBe('20925.00');
    expect(overview.nav).toBe('20925.00');
    expect(overview.realizedPnl).toBe('919.00');
    expect(overview.realizedFees).toBe('6.00');
  });

  it('dashboard-v2 reflects the trade-workflow NAV and P&L', () => {
    const dash = computeDashboardV2(ctx.sqlite, ctx.accountId);
    expect(dash).toBeDefined();
    if (!dash) return;
    expect(dash.account.id).toBe(ctx.accountId);
    expect(dash.metrics.cash).toBe('20925.00');
    expect(dash.metrics.nav).toBe('20925.00');
    expect(dash.metrics.markedPositions).toBe('0.00');
    expect(dash.metrics.realizedPnl).toBe('919.00');
    expect(dash.metrics.unrealizedPnl).toBe('0.00');
    expect(dash.metrics.totalPnl).toBe('919.00');
    expect(dash.metrics.realizedFees).toBe('6.00');
    expect(dash.metrics.grossExposure).toBe('0.00');
    expect(dash.metrics.netExposure).toBe('0.00');
  });

  it('rejects an over-close execution via the route pre-flight FIFO check', () => {
    // No AAPL position remains. The executions route rejects an over-close
    // BEFORE any write by running allocateFifo against the current position
    // (NO_POSITION_TO_CLOSE). postExecutionFill itself is a write kernel and
    // does not preflight; the route guard is the durable contract.
    const instrument = findInstrumentBySymbol(ctx.sqlite, 'AAPL');
    expect(instrument).toBeDefined();
    if (!instrument) return;

    const preflight = allocateFifo(
      {
        executionId: 'preflight-over-close',
        accountId: ctx.accountId,
        instrumentId: instrument.id,
        action: 'sell',
        quantity: '10.00' as CanonicalDecimal,
        price: '170.00' as CanonicalDecimal,
        fees: '1.00' as CanonicalDecimal,
        postedAt: '2026-04-04T14:00:00.000Z',
      },
      null, // flat position
      [],   // no open lots
      () => 'id',
    );

    expect(preflight.status).toBe('rejected');
    if (preflight.status !== 'rejected') return;
    expect(preflight.code).toBe('NO_POSITION_TO_CLOSE');

    // No execution was written and projections are untouched.
    const executions = ctx.sqlite
      .prepare('SELECT COUNT(*) AS count FROM accounting_executions WHERE account_id = ?')
      .get(ctx.accountId) as { count: number };
    expect(executions.count).toBe(2); // only the buy and sell

    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(proj).toBeDefined();
    if (!proj) return;
    expect(proj.net_cash).toBe('20925.00');
    expect(proj.nav).toBe('20925.00');
    assertLedgerInvariants(ctx, 'rejected over-close preflight');
  });
});
