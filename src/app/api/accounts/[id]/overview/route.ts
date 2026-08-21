/**
 * Account Overview API Route
 *
 * GET /api/accounts/:id/overview — authoritative accounting overview for the
 *   Overview workspace tab.
 *
 * Composes four sub-payloads from the existing accounting repositories:
 *   - snapshot: 9-field accounting projection (netCash, nav, markedPositions,
 *     realizedPnl, unrealizedPnl, totalPnl, realizedFees, grossExposure,
 *     netExposure), all nullable
 *   - reconciliation: banner state (eligible / stale / blocked) with counts
 *   - positions: up to 5 open position rows with valuation-mark enrichment
 *   - events: up to 10 latest authoritative ledger events with category and
 *     basic shape
 *
 * All numeric values are canonical decimal strings or null.  Empty arrays
 * are returned for accounts with no positions or events.  Missing-price
 * status is preserved as null rather than fabricated zero values.
 *
 * @module overview/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';
import {
  accountExists,
  findAccountPerformance,
  listAccountPositions,
  listLatestValuationMarks,
  findInstrumentById,
} from '@/db/accounting-repository';
import { computeReconciliation } from '@/lib/accounting/reconciliation';
import {
  composeOverviewSnapshot,
  deriveBannerState,
  mapPositionRow,
} from '@/lib/account-detail';
import type { ValuationMarkRow } from '@/db/accounting-repository';

type RouteParams = { params: Promise<{ id: string }> };

// ── Constants ───────────────────────────────────────────────────────────

/** Max position rows returned in the positions preview. */
const MAX_POSITIONS_PREVIEW = 5;

/** Max event rows returned in the recent-events preview. */
const MAX_EVENTS_PREVIEW = 10;

// ── GET ─────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts/:id/overview
 *
 * Composes the account overview from 4 sub-sources:
 * - Accounting performance projection (snapshot)
 * - Reconciliation health (banner)
 * - Open positions (preview)
 * - Recent ledger events (preview)
 *
 * Responses:
 * - 200: Complete overview response with snapshot, reconciliation,
 *        positions, and events
 * - 404: Account not found
 * - 500: Unexpected server error
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: accountId } = await params;
    const sqlite = getSqliteHandle();

    // 1. Verify account exists
    if (!accountExists(sqlite, accountId)) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 },
      );
    }

    // 1b. Account identity (name, currency, active state). The workspace
    //     needs these to render the empty-account initialization state and
    //     to show the correct overview for a draft (inactive, no events)
    //     account without a second fetch.
    const accountRow = sqlite
      .prepare(
        `SELECT name, broker, currency, is_active AS isActive
         FROM accounts WHERE id = ?`,
      )
      .get(accountId) as
      | { name: string; broker: string | null; currency: string | null; isActive: number }
      | undefined;

    // ── 2. Overview Snapshot ──────────────────────────────────────────
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

    // ── 3. Reconciliation Banner ──────────────────────────────────────
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
      // Reconciliation fetch is best-effort for the overview
    }

    // ── 4. Positions Preview (up to 5) ────────────────────────────────
    const allPositions = listAccountPositions(sqlite, accountId);
    const marks = listLatestValuationMarks(sqlite, accountId);

    // Build a mark-by-instrument cache for quick lookup
    const markCache = new Map<string, ValuationMarkRow>();
    for (const m of marks) {
      markCache.set(m.instrument_id, m);
    }

    // Instrument symbol cache
    const instrumentCache = new Map<string, string>();
    function resolveSymbol(instrumentId: string): string {
      const cached = instrumentCache.get(instrumentId);
      if (cached) return cached;
      const instr = findInstrumentById(sqlite, instrumentId);
      const symbol = instr?.symbol ?? 'UNKNOWN';
      instrumentCache.set(instrumentId, symbol);
      return symbol;
    }

    // Map open positions (quantity !== 0.00 and direction is not null)
    const openPositions = allPositions
      .filter((p) => p.quantity !== '0.00' && p.direction !== null)
      .slice(0, MAX_POSITIONS_PREVIEW)
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
          markTimestamp: mark?.mark_timestamp ?? null,
          markPrice: mark?.price ?? null,
          markPriceMicros: mark?.price_micros ?? null,
          markAgeMinutes: mark
            ? Math.floor(
                (Date.now() - new Date(mark.mark_timestamp).getTime()) / 60_000,
              )
            : null,
        });
      });

    // ── 5. Recent Events Preview (up to 10, newest first) ─────────────
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
         LIMIT ?`,
      )
      .all(accountId, MAX_EVENTS_PREVIEW) as Array<{
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

    // Total event count for the account
    const eventsTotal = (
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_events WHERE account_id = ?')
        .get(accountId) as { count: number }
    ).count;

    // Map events to a lightweight shape for the overview, extracting
    // trade association from the payload when available.
    const events = eventRows.map((row) => {
      let tradeId: string | null = null;
      if (row.payload && row.event_type === 'trade_execution') {
        try {
          const parsed = JSON.parse(row.payload);
          if (parsed.journalTradeId && typeof parsed.journalTradeId === 'string') {
            tradeId = parsed.journalTradeId;
          }
        } catch {
          // Malformed payload — no trade association available
        }
      }
      return {
        id: row.id,
        eventType: row.event_type,
        description: row.description,
        postedAt: row.posted_at,
        tradeId,
        status: {
          hasEntry: row.entry_id !== null,
          isBalanced: row.is_balanced === 1,
          postingCount: row.posting_count,
        },
      };
    });

    // ── 6. Return composed response ───────────────────────────────────
    return NextResponse.json(
      {
        accountId,
        isActive: Boolean(accountRow?.isActive),
        name: accountRow?.name ?? null,
        currency: accountRow?.currency ?? null,
        snapshot,
        reconciliation,
        positions: openPositions,
        positionsTotal: allPositions.filter((p) => p.quantity !== '0.00' && p.direction !== null).length,
        events,
        eventsTotal,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch account overview',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
