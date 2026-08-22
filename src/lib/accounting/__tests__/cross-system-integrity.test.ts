/**
 * Cross-system integrity test — full event lifecycle through the real
 * posting kernel and projection engines.
 *
 * S06/T01 verification surface: exercises the complete cash-event lifecycle
 * (opening balance → deposit → withdrawal → dividend → interest → fee → tax
 * → manual_adjustment → correction) through the production services
 * (event-posting + posting kernel, financial-event correction) against a
 * real migrated SQLite database, and verifies that every derived projection
 * stays mutually consistent at each step:
 *
 *   - cash        → rebuildOpeningCash + computeAccountCashImpact (activity)
 *   - NAV/P&L     → rebuildAccountPerformance → account_performance row
 *   - fees        → realizedFees in the same projection
 *   - overview    → composeOverviewSnapshot (account-detail Overview tab)
 *   - ledger      → buildLedgerProjection (account-detail Ledger tab),
 *                   correction-group dedup + posting integrity
 *   - performance → modifiedDietzReturn / twr / highWaterMark / drawdown
 *   - dashboard   → computeDashboardV2 current-state aggregation
 *
 * No existing test drives this full lifecycle end-to-end through the real
 * posting kernel, the rebuild engine, the ledger adapter, the overview
 * composer, and the dashboard-v2 aggregator on one shared database.
 *
 * Run: npx vitest run src/lib/accounting/__tests__/cross-system-integrity.test.ts
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
import { correctFinancialEvent } from '../financial-event-correction';
import { rebuildAccountPerformance } from '../../performance/performance-rebuild';
import { computeDashboardV2 } from '../dashboard-v2';
import { composeOverviewSnapshot } from '../../account-detail';
import {
  findAccountPerformance,
  listAccountEvents,
  findPostingsByEntryId,
  listFinancialEventCorrectionsByAccount,
} from '@/db/accounting-repository';

// ── Test Database Setup ─────────────────────────────────────────────────

interface TestContext {
  sqlite: Database.Database;
  accountId: string;
}

/**
 * Apply every committed migration to the test database in order.
 * Mirrors the pattern used by the other accounting integration tests.
 */
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

function createTestContext(): TestContext {
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
    .run(accountId, 'Integrity Test Account', 'Test Broker', 'USD', now, now);

  return { sqlite, accountId };
}

function destroyTestContext(ctx: TestContext): void {
  ctx.sqlite.close();
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a plain request body through the same zod schema the
 * POST /api/accounts/:id/financial-events route uses.
 */
function parseEventRequest(body: Record<string, unknown>) {
  const parsed = postFinancialEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

/**
 * Post a cash financial event through the production event-posting service.
 */
function postCashEvent(
  ctx: TestContext,
  body: Record<string, unknown>,
): { eventId: string } {
  const result = postEventWithEffect(ctx.sqlite, ctx.accountId, parseEventRequest(body));
  return { eventId: result.event.id };
}

/**
 * Rebuild the account performance projection (the same call the financial
 * events / executions / correction routes make after mutating events).
 */
function rebuildProjection(ctx: TestContext) {
  return rebuildAccountPerformance(ctx.sqlite, ctx.accountId);
}

/**
 * Compose the Ledger-tab projection exactly the way the
 * GET /api/accounts/:id/ledger route does.
 */
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

/** Format check for canonical decimal strings. */
const CANONICAL_DECIMAL_RE = /^-?\d+\.\d{2}$/;

/**
 * The cross-system consistency assertion shared by every lifecycle step.
 * Verifies cash, NAV, P&L, fees, overview, ledger, and performance agree
 * after the posting kernel + rebuild engine have run.
 */
function assertProjectionsConsistent(
  ctx: TestContext,
  stepLabel: string,
  expected: {
    cash: string;
    highWaterMark: string;
    drawdown: string;
    /**
     * Expected raw financial events (activity rebuild lists every event,
     * including correction reversal/replacement constituents).
     */
    rawEventCount: number;
    /** Expected visible ledger rows after correction-group dedup. */
    ledgerRowCount: number;
    /** Expected eventType + cash impact of the last visible ledger row. */
    lastLedgerRow: { eventType: string; cashImpact: string | null };
  },
): void {
  const { sqlite, accountId } = ctx;
  const where = `${stepLabel}:`;

  // ── 1. Ledger integrity ─────────────────────────────────────────────
  const balance = checkLedgerBalance(sqlite);
  expect(balance.isBalanced, `${where} global ledger is balanced`).toBe(true);

  const netPosition = rebuildNetPosition(sqlite, accountId);
  expect(netPosition.netAmount, `${where} per-account postings net to zero`).toBe('0.00');

  // ── 2. Opening-cash projection ─────────────────────────────────────
  const openingCash = rebuildOpeningCash(sqlite, accountId);
  expect(openingCash.totalOpeningCash, `${where} opening cash stable`).toBe('10000.00');
  expect(openingCash.events, `${where} exactly one opening-balance event`).toHaveLength(1);

  // ── 3. Activity / cash-flow projection ─────────────────────────────
  const activity = computeAccountActivity(sqlite, accountId);
  expect(activity.totalCount, `${where} activity rebuild lists every raw event`).toBe(
    expected.rawEventCount,
  );
  const cashImpact = computeAccountCashImpact(sqlite, accountId);
  expect(cashImpact.netCashImpact, `${where} activity net cash`).toBe(expected.cash);

  // ── 4. Performance projection (NAV / P&L / fees) ───────────────────
  const proj = findAccountPerformance(sqlite, accountId);
  expect(proj, `${where} performance projection exists`).toBeDefined();
  if (!proj) return;

  expect(proj.net_cash, `${where} projection net cash`).toBe(expected.cash);
  expect(proj.nav, `${where} NAV equals net cash (no positions)`).toBe(expected.cash);
  expect(proj.marked_positions, `${where} no marked positions`).toBe('0.00');
  // Cash events are funding flows / account fees — not realized P&L.
  expect(proj.realized_pnl, `${where} no realized P&L`).toBe('0.00');
  expect(proj.unrealized_pnl, `${where} no unrealized P&L`).toBe('0.00');
  expect(proj.total_pnl, `${where} no total P&L`).toBe('0.00');
  // Account-level fees are cash outflows; realizedFees comes from executions.
  expect(proj.realized_fees, `${where} no realized execution fees`).toBe('0.00');
  expect(proj.gross_exposure, `${where} no gross exposure`).toBe('0.00');
  expect(proj.net_exposure, `${where} no net exposure`).toBe('0.00');

  // Performance metrics.
  expect(proj.high_water_mark, `${where} high-water mark`).toBe(expected.highWaterMark);
  expect(proj.drawdown, `${where} drawdown`).toBe(expected.drawdown);
  expect(proj.modified_dietz_return, `${where} Dietz present`).toMatch(CANONICAL_DECIMAL_RE);
  expect(proj.twr, `${where} TWR present`).toMatch(CANONICAL_DECIMAL_RE);
  // Implementation invariant: with this cash-flow set TWR chain-links the
  // single Modified-Dietz sub-period, so the two stored values agree.
  expect(proj.twr, `${where} TWR equals Modified Dietz`).toBe(proj.modified_dietz_return);
  expect(() => JSON.parse(proj.warnings), `${where} warnings parse as JSON`).not.toThrow();
  expect(Array.isArray(JSON.parse(proj.warnings))).toBe(true);

  // ── 5. Overview snapshot mirrors the projection ────────────────────
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
  expect(overview.netCash, `${where} overview net cash`).toBe(expected.cash);
  expect(overview.nav, `${where} overview NAV`).toBe(expected.cash);
  expect(overview.markedPositions).toBe('0.00');
  expect(overview.realizedPnl).toBe('0.00');
  expect(overview.unrealizedPnl).toBe('0.00');
  expect(overview.totalPnl).toBe('0.00');
  expect(overview.realizedFees).toBe('0.00');
  expect(overview.grossExposure).toBe('0.00');
  expect(overview.netExposure).toBe('0.00');

  // ── 6. Ledger projection ───────────────────────────────────────────
  const ledger = composeLedgerProjection(ctx);
  expect(ledger.total, `${where} ledger row count`).toBe(expected.ledgerRowCount);
  expect(ledger.events, `${where} ledger rows`).toHaveLength(expected.ledgerRowCount);

  // Every posted event carries a balanced posting pair.
  const eventRows = listAccountEvents(sqlite, accountId);
  for (const row of eventRows) {
    expect(row.entry_id, `${where} event ${row.event_type} has a ledger entry`).not.toBeNull();
    expect(row.posting_count, `${where} event ${row.event_type} has 2 postings`).toBe(2);
    expect(row.is_balanced, `${where} event ${row.event_type} is balanced`).toBe(1);
  }

  const last = ledger.events[ledger.events.length - 1];
  expect(last, `${where} last ledger row present`).toBeDefined();
  expect(last!.eventType, `${where} last ledger row type`).toBe(expected.lastLedgerRow.eventType);
  expect(last!.cashImpact, `${where} last ledger row cash impact`).toBe(
    expected.lastLedgerRow.cashImpact,
  );
  expect(last!.status.hasEntry).toBe(true);
  expect(last!.status.isBalanced).toBe(true);
  expect(last!.status.postingCount).toBe(2);
}

// ── Lifecycle Definition ────────────────────────────────────────────────

interface LifecycleStep {
  label: string;
  body: Record<string, unknown>;
  eventType: string;
  cash: string;
  cashImpact: string;
  highWaterMark: string;
  drawdown: string;
}

/**
 * The full cash-event lifecycle. `postedAt` is pinned so ledger ordering and
 * the cash-flow weight computations are deterministic. Expected cash is the
 * running balance; HWM/drawdown follow the rebuild chain where
 * startNav = previous projection NAV (max of current and start NAV).
 */
const LIFECYCLE: LifecycleStep[] = [
  {
    label: 'opening balance',
    body: {
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Initial funding',
      postedAt: '2026-01-05T14:00:00.000Z',
    },
    eventType: 'opening_balance',
    cash: '10000.00',
    cashImpact: '10000.00',
    highWaterMark: '10000.00',
    drawdown: '0.00',
  },
  {
    label: 'deposit',
    body: {
      eventType: 'deposit',
      amount: '2500.00',
      description: 'Transfer in',
      postedAt: '2026-01-06T14:00:00.000Z',
    },
    eventType: 'deposit',
    cash: '12500.00',
    cashImpact: '2500.00',
    highWaterMark: '12500.00',
    drawdown: '0.00',
  },
  {
    label: 'withdrawal',
    body: {
      eventType: 'withdrawal',
      amount: '1000.00',
      description: 'Transfer out',
      postedAt: '2026-01-07T14:00:00.000Z',
    },
    eventType: 'withdrawal',
    cash: '11500.00',
    cashImpact: '-1000.00',
    highWaterMark: '12500.00',
    drawdown: '1000.00',
  },
  {
    label: 'dividend',
    body: {
      eventType: 'dividend',
      amount: '300.00',
      perShareAmount: '3.00',
      shares: 100,
      description: 'Quarterly dividend',
      postedAt: '2026-01-08T14:00:00.000Z',
    },
    eventType: 'dividend',
    cash: '11800.00',
    cashImpact: '300.00',
    highWaterMark: '11800.00',
    drawdown: '0.00',
  },
  {
    label: 'interest',
    body: {
      eventType: 'interest',
      amount: '50.00',
      rate: '4.50',
      description: 'Cash sweep interest',
      postedAt: '2026-01-09T14:00:00.000Z',
    },
    eventType: 'interest',
    cash: '11850.00',
    cashImpact: '50.00',
    highWaterMark: '11850.00',
    drawdown: '0.00',
  },
  {
    label: 'fee',
    body: {
      eventType: 'fee',
      amount: '75.00',
      feeType: 'commission',
      description: 'Monthly platform fee',
      postedAt: '2026-01-10T14:00:00.000Z',
    },
    eventType: 'fee',
    cash: '11775.00',
    cashImpact: '-75.00',
    highWaterMark: '11850.00',
    drawdown: '75.00',
  },
  {
    label: 'tax',
    body: {
      eventType: 'tax',
      amount: '25.00',
      taxType: 'withholding',
      description: 'Dividend withholding',
      postedAt: '2026-01-11T14:00:00.000Z',
    },
    eventType: 'tax',
    cash: '11750.00',
    cashImpact: '-25.00',
    highWaterMark: '11775.00',
    drawdown: '25.00',
  },
  {
    label: 'manual_adjustment (credit)',
    body: {
      eventType: 'manual_adjustment',
      amount: '500.00',
      reason: 'Reconciliation credit',
      postedAt: '2026-01-12T14:00:00.000Z',
    },
    eventType: 'manual_adjustment',
    cash: '12250.00',
    cashImpact: '500.00',
    highWaterMark: '12250.00',
    drawdown: '0.00',
  },
  {
    label: 'manual_adjustment (debit)',
    body: {
      eventType: 'manual_adjustment',
      amount: '-250.00',
      reason: 'Bank fee correction',
      postedAt: '2026-01-13T14:00:00.000Z',
    },
    eventType: 'manual_adjustment',
    cash: '12000.00',
    cashImpact: '-250.00',
    highWaterMark: '12250.00',
    drawdown: '250.00',
  },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe('cross-system integrity — full cash-event lifecycle', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestContext();
  });

  afterAll(() => {
    destroyTestContext(ctx);
  });

  it('posts the full lifecycle and keeps every projection consistent at each step', () => {
    for (let i = 0; i < LIFECYCLE.length; i++) {
      const step = LIFECYCLE[i];

      const { eventId } = postCashEvent(ctx, step.body);
      expect(eventId).toBeTruthy();

      const rebuild = rebuildProjection(ctx);
      expect(rebuild.success, `${step.label}: performance rebuild succeeds`).toBe(true);
      expect(rebuild.nav, `${step.label}: rebuild NAV`).toBe(step.cash);
      expect(rebuild.warnings, `${step.label}: rebuild warnings array`).toBeInstanceOf(Array);

      assertProjectionsConsistent(ctx, step.label, {
        cash: step.cash,
        highWaterMark: step.highWaterMark,
        drawdown: step.drawdown,
        rawEventCount: i + 1,
        ledgerRowCount: i + 1,
        lastLedgerRow: { eventType: step.eventType, cashImpact: step.cashImpact },
      });
    }
  });

  it('rebuilds deterministically — repeated rebuilds produce identical projections', () => {
    const before = findAccountPerformance(ctx.sqlite, ctx.accountId);
    expect(before).toBeDefined();
    if (!before) return;

    const first = rebuildProjection(ctx);
    const second = rebuildProjection(ctx);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const afterFirst = findAccountPerformance(ctx.sqlite, ctx.accountId)!;
    const afterSecond = findAccountPerformance(ctx.sqlite, ctx.accountId)!;

    // Values are stable across rebuilds; only the rebuild counter advances.
    expect(afterFirst.net_cash).toBe(before.net_cash);
    expect(afterFirst.nav).toBe(before.nav);
    expect(afterFirst.realized_pnl).toBe(before.realized_pnl);
    expect(afterSecond.net_cash).toBe(afterFirst.net_cash);
    expect(afterSecond.nav).toBe(afterFirst.nav);
    expect(afterSecond.rebuild_count).toBe(afterFirst.rebuild_count);
    expect(afterFirst.rebuild_count).toBeGreaterThan(before.rebuild_count);
  });

  it('dashboard-v2 current-state aggregation agrees with the ledger projections', () => {
    const dash = computeDashboardV2(ctx.sqlite, ctx.accountId);
    expect(dash, 'dashboard snapshot computed').toBeDefined();
    if (!dash) return;

    expect(dash.account.id).toBe(ctx.accountId);
    expect(dash.metrics.cash).toBe('12000.00');
    expect(dash.metrics.nav).toBe('12000.00');
    expect(dash.metrics.markedPositions).toBe('0.00');
    expect(dash.metrics.realizedPnl).toBe('0.00');
    expect(dash.metrics.unrealizedPnl).toBe('0.00');
    expect(dash.metrics.totalPnl).toBe('0.00');
    expect(dash.metrics.realizedFees).toBe('0.00');
    expect(dash.metrics.grossExposure).toBe('0.00');
    expect(dash.metrics.netExposure).toBe('0.00');
    expect(dash.valuation.positionsTotal).toBe(0);
    expect(dash.valuation.state).toBe('complete');
    // Scope identity: the accountPositions scope targets the valuation section.
    expect(dash.scopes.accountPositions.id).toBe('account_positions');
    expect(dash.scopes.accountPositions.section).toBe('valuation');
    expect(dash.integrity.status).toMatch(/^(healthy|warning)$/);
  });
});

describe('cross-system integrity — correction consistency', () => {
  let ctx: TestContext;
  /** The fee event id (last event in the lifecycle before the correction). */
  let feeEventId = '';
  /** Total events visible in the ledger before the correction. */
  const preCorrectionEvents = LIFECYCLE.length;

  beforeAll(() => {
    ctx = createTestContext();

    // Replay the full lifecycle.
    for (const step of LIFECYCLE) {
      const result = postEventWithEffect(ctx.sqlite, ctx.accountId, parseEventRequest(step.body));
      if (step.eventType === 'fee') {
        feeEventId = result.event.id;
      }
    }
    rebuildProjection(ctx);
  });

  afterAll(() => {
    destroyTestContext(ctx);
  });

  it('corrects the posted fee (75.00 → 90.00) and keeps every projection consistent', () => {
    expect(feeEventId).toBeTruthy();

    const correction = correctFinancialEvent(ctx.sqlite, {
      accountId: ctx.accountId,
      originalEventId: feeEventId,
      amount: '90.00',
      reason: 'Fee was mis-entered; corrected from 75.00 to 90.00',
    });

    expect(correction.correction.originalEventId).toBe(feeEventId);
    expect(correction.reversalEvent.eventType).toBe('fee');
    expect(correction.replacementEvent.eventType).toBe('fee');
    expect(correction.replacementEvent.postedAt > correction.originalEvent.postedAt).toBe(true);

    // Cash: original fee -75.00 is cancelled by reversal +75.00 and replaced
    // by replacement -90.00 → net -15.00 vs the original.
    const finalCash = '11985.00';

    assertProjectionsConsistent(ctx, 'fee correction', {
      cash: finalCash,
      highWaterMark: '12000.00',
      drawdown: '15.00',
      // 9 lifecycle events + 2 correction constituents (reversal + replacement).
      rawEventCount: preCorrectionEvents + 2,
      // 11 raw events (9 lifecycle + reversal + replacement) minus 3
      // correction constituents (original fee, reversal, replacement)
      // plus 1 grouped correction row = 9 visible ledger rows.
      ledgerRowCount: preCorrectionEvents + 2 - 3 + 1,
      lastLedgerRow: { eventType: 'fee', cashImpact: '-90.00' },
    });

    // ── Correction lineage persisted ──────────────────────────────────
    const corrections = listFinancialEventCorrectionsByAccount(ctx.sqlite, ctx.accountId);
    expect(corrections, 'correction lineage row exists').toHaveLength(1);
    expect(corrections[0].original_event_id).toBe(feeEventId);
    expect(corrections[0].reversal_event_id).toBe(correction.reversalEvent.id);
    expect(corrections[0].replacement_event_id).toBe(correction.replacementEvent.id);
    expect(corrections[0].reason).toContain('mis-entered');

    // ── Ledger projection: correction grouped, constituents hidden ────
    const ledger = composeLedgerProjection(ctx);
    const correctionRows = ledger.events.filter((e) => e.correctionGroup !== null);
    expect(correctionRows, 'exactly one grouped correction row').toHaveLength(1);
    expect(correctionRows[0].correctionGroup!.originalEventId).toBe(feeEventId);
    expect(correctionRows[0].correctionGroup!.reversalEventId).toBe(correction.reversalEvent.id);
    expect(correctionRows[0].correctionGroup!.replacementEventId).toBe(
      correction.replacementEvent.id,
    );

    // The original / reversal / replacement events must not appear standalone.
    const visibleIds = new Set(ledger.events.map((e) => e.eventId));
    expect(visibleIds.has(feeEventId)).toBe(false);
    expect(visibleIds.has(correction.reversalEvent.id)).toBe(false);
    expect(visibleIds.has(correction.replacementEvent.id)).toBe(false);

    // The grouped row displays the replacement's event type + cash impact.
    expect(correctionRows[0].eventType).toBe('fee');
    expect(correctionRows[0].cashImpact).toBe('-90.00');
    expect(correctionRows[0].status.hasEntry).toBe(true);
    expect(correctionRows[0].status.isBalanced).toBe(true);
    expect(correctionRows[0].status.postingCount).toBe(2);
  });

  it('keeps the corrected NAV stable across a rebuild and reflects it in dashboard-v2', () => {
    const rebuild = rebuildProjection(ctx);
    expect(rebuild.success).toBe(true);
    expect(rebuild.nav).toBe('11985.00');

    const proj = findAccountPerformance(ctx.sqlite, ctx.accountId)!;
    expect(proj.net_cash).toBe('11985.00');
    expect(proj.nav).toBe('11985.00');

    const dash = computeDashboardV2(ctx.sqlite, ctx.accountId);
    expect(dash).toBeDefined();
    if (!dash) return;
    expect(dash.metrics.cash).toBe('11985.00');
    expect(dash.metrics.nav).toBe('11985.00');
  });
});
