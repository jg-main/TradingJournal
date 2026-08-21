import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { accounts, accountTransactions, settings, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { type ExecutionData } from '@/lib/trade-metrics';
import { computeAccountKPIs, computeAccountBalance, computeDatesActive } from '@/lib/account-summary';
import { findAccountPerformance } from '@/db/accounting-repository';
import { canDeactivateAccount } from '@/lib/account-lifecycle';
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

    // 2. Fetch account base fields
    const startingBalance = account.startingBalance ?? 0;
    const accountCreatedAt = account.createdAt ?? new Date().toISOString();

    // 3. Query all closed trades for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(and(eq(trades.accountId, id), eq(trades.status, 'closed')))
      .all();

    // 4. Compute KPIs using shared library
    let kpis: { tradeCount: number; netPnl: number; winRate: number | null; avgR: number | null; avgGrade: number | null };
    if (closedTrades.length > 0) {
      const tradeIds = closedTrades.map((t) => t.id);

      // Fetch all executions for the closed trades in one query
      const allExecutions = db
        .select()
        .from(tradeExecutions)
        .where(inArray(tradeExecutions.tradeId, tradeIds))
        .all();

      // Group executions by tradeId, mapped to ExecutionData format
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

      // Fetch risk snapshots and grades
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

      // Delegate KPI computation to shared library
      kpis = computeAccountKPIs(closedTrades, execByTradeId, riskSnapshots, grades);
    } else {
      kpis = { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null };
    }

    // 5. Query accountTransactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .all();

    // 6. Delegate balance computation to shared library
    const balance = computeAccountBalance(startingBalance, transactions, kpis.netPnl);

    // Compute netReturn (unique to closure response)
    const netReturn = balance.netDeposits > 0
      ? (balance.realizedPnl / balance.netDeposits) * 100
      : null;

    // 7. Delegate datesActive computation to shared library
    const datesActive = computeDatesActive(accountCreatedAt, transactions);

    // ── 7b. Fetch accounting ledger-derived realized P&L (best-effort) ──
    let accountingRealizedPnl: string | null = null;
    let accountingNav: string | null = null;
    let accountingLedgerDerived = false;
    try {
      const sqlite = getSqliteHandle();
      const projection = findAccountPerformance(sqlite, id);
      if (projection) {
        accountingRealizedPnl = projection.realized_pnl;
        accountingNav = projection.nav;
        accountingLedgerDerived = true;
      }
    } catch {
      // Accounting projection fetch is best-effort during closure
    }

    // Use accounting-derived realized P&L when available (ledger is the source of truth)
    const activeRealizedPnl = accountingLedgerDerived && accountingRealizedPnl
      ? parseFloat(accountingRealizedPnl)
      : balance.realizedPnl;
    const activeFinalBalance = accountingLedgerDerived && accountingNav
      ? parseFloat(accountingNav)
      : balance.currentBalance;

    // 8. Deactivate the account
    db.update(accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    // 8b. Default-account coherence (D6): closing the settings default account
    // leaves a stale reference that consumers silently fall back from. Clear it
    // so resolution moves to the first active account. No-op when this account
    // is not the configured default.
    db.update(settings)
      .set({ defaultAccountId: null, updatedAt: new Date().toISOString() })
      .where(eq(settings.defaultAccountId, id))
      .run();

    // 9. Return closure summary JSON with accounting-derived metrics
    return NextResponse.json({
      accountId: id,
      accountName: account.name,
      startingBalance,
      depositsTotal: balance.netDeposits,
      withdrawalsTotal: balance.netWithdrawals,
      realizedPnl: activeRealizedPnl,
      finalBalance: activeFinalBalance,
      netReturn,
      kpis,
      datesActive,
      closedAt: new Date().toISOString(),
      // Accounting provenance (read-only audit trail)
      accounting: {
        ledgerDerived: accountingLedgerDerived,
        realizedPnl: accountingRealizedPnl,
        nav: accountingNav,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to close account', details: String(error) },
      { status: 500 },
    );
  }
}
