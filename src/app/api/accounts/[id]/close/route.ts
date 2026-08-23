/**
 * Account Close API Route (A3 — canonical closure summary).
 *
 * POST /api/accounts/:id/close — deactivate an account and produce its
 * lifetime closure summary.
 *
 * Financial/account state comes EXCLUSIVELY from the canonical accounting
 * model:
 *
 *   - identity / lifecycle        → accounts
 *   - opening capital, deposits, withdrawals, activity dates
 *                                → financial_events + canonical effects
 *                                  (computeAccountActivity +
 *                                  deriveAccountClosureCapital)
 *   - final balance / realized P&L → account_performance, freshly rebuilt
 *                                  and REQUIRED to succeed
 *   - trade statistics            → canonical/shared computeAccountKPIs
 *
 * Legacy sources (accounts.startingBalance, accountTransactions,
 * computeAccountBalance, computeDatesActive) are NOT used — the closure is
 * correction-aware by construction (reversal/replacement events net through
 * cash-effect directions) and contradictory legacy rows cannot influence it.
 *
 * A failed projection rebuild → 500, account stays active, default reference
 * unchanged, close retryable. Open-trade accounts → 409 (lifecycle guard
 * preserved). Closing the configured default account clears
 * settings.defaultAccountId (D6 coherence, preserved).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { accounts, settings, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { type ExecutionData } from '@/lib/trade-metrics';
import { computeAccountKPIs } from '@/lib/account-summary';
import { computeAccountClosureFinancials } from '@/lib/accounting/account-closure';
import { canDeactivateAccount } from '@/lib/account-lifecycle';
import { AccountClosureProjectionError } from '@/lib/accounting/errors';
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // 1. Validate account exists and is active
    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (!account.isActive) {
      return NextResponse.json({ error: 'Account is already inactive' }, { status: 400 });
    }

    // 1b. Open-trade guard (D5): closing deactivates the account, so it must
    // carry the same safety rule as PUT {isActive:false}. An account with open
    // positions must wind those down before closure — otherwise the account
    // would be deactivated while still carrying live market exposure.
    const accountTrades = db.select({ status: trades.status }).from(trades).where(eq(trades.accountId, id)).all();
    if (!canDeactivateAccount(accountTrades)) {
      return NextResponse.json(
        {
          error:
            'Cannot close account with open trades. ' +
            'Close or cancel all open positions before closing the account.',
        },
        { status: 409 },
      );
    }

    // 1c. Single closure timestamp, captured once and reused for
    // datesActive.to, the deactivation updatedAt, and response.closedAt.
    const closedAt = new Date().toISOString();
    const accountCreatedAt = account.createdAt ?? closedAt;

    // 2. Query all closed trades for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(and(eq(trades.accountId, id), eq(trades.status, 'closed')))
      .all();

    // 3. Compute KPIs using the shared canonical trade-metrics library
    //    (trade count, net P&L, win rate, avg R, avg grade — authoritative
    //    trade statistics; NOT the account-level closure financials).
    let kpis: { tradeCount: number; netPnl: number; winRate: number | null; avgR: number | null; avgGrade: number | null };
    if (closedTrades.length > 0) {
      const tradeIds = closedTrades.map((t) => t.id);

      const allExecutions = db
        .select()
        .from(tradeExecutions)
        .where(inArray(tradeExecutions.tradeId, tradeIds))
        .all();

      const execByTradeId = new Map<string, ExecutionData[]>();
      for (const exec of allExecutions) {
        const list = execByTradeId.get(exec.tradeId) ?? [];
        list.push({
          action: exec.action,
          quantity: exec.quantity,
          price: exec.price,
          fees: exec.fees ?? 0,
          executedAt: exec.executedAt ?? new Date().toISOString(),
        });
        execByTradeId.set(exec.tradeId, list);
      }

      const riskSnapshots = db
        .select()
        .from(tradeRiskSnapshots)
        .where(inArray(tradeRiskSnapshots.tradeId, tradeIds))
        .all();

      const grades = db
        .select()
        .from(tradeGrades)
        .where(inArray(tradeGrades.tradeId, tradeIds))
        .all();

      kpis = computeAccountKPIs(closedTrades, execByTradeId, riskSnapshots, grades);
    } else {
      kpis = { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null };
    }

    // 4. Canonical closure financials: fresh REQUIRED projection rebuild +
    //    correction-aware capital + NAV / realized P&L / netReturn /
    //    datesActive. Throws AccountClosureProjectionError (→ 500) when the
    //    rebuild fails — the account is NOT deactivated in that case.
    const sqlite = getSqliteHandle();
    const financials = computeAccountClosureFinancials(sqlite, id, closedAt, accountCreatedAt);

    // 5. Deactivate the account (updatedAt = the single closure timestamp).
    db.update(accounts)
      .set({ isActive: false, updatedAt: closedAt })
      .where(eq(accounts.id, id))
      .run();

    // 5b. Default-account coherence (D6): closing the settings default account
    // leaves a stale reference that consumers silently fall back from. Clear it
    // so resolution moves to the first active account. No-op when this account
    // is not the configured default.
    db.update(settings)
      .set({ defaultAccountId: null, updatedAt: closedAt })
      .where(eq(settings.defaultAccountId, id))
      .run();

    // 6. Return the canonical closure summary (compatible response shape —
    //    `startingBalance` is retained for backward compatibility and now
    //    means the EFFECTIVE canonical opening balance; `openingBalance` is
    //    the clearer alias).
    return NextResponse.json({
      accountId: id,
      accountName: account.name,
      startingBalance: financials.startingBalance,
      openingBalance: financials.openingBalance,
      depositsTotal: financials.depositsTotal,
      withdrawalsTotal: financials.withdrawalsTotal,
      realizedPnl: financials.realizedPnl,
      finalBalance: financials.finalBalance,
      netReturn: financials.netReturn,
      kpis,
      datesActive: financials.datesActive,
      closedAt: financials.closedAt,
      // Accounting provenance — always canonical (ledger-derived) for a
      // current account.
      accounting: financials.accounting,
    });
  } catch (error) {
    // Projection rebuild failure: unexpected server-side failure — never 409.
    // The account was NOT deactivated, so the close is retryable.
    if (error instanceof AccountClosureProjectionError) {
      return NextResponse.json(
        {
          error: 'Failed to close account',
          details: error.message,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to close account', details: String(error) },
      { status: 500 },
    );
  }
}
