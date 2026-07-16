import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { accounts, accountTransactions, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type ExecutionData } from '@/lib/trade-calc';
import { computeAccountKPIs, computeAccountBalance } from '@/lib/account-summary';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount } from '@/lib/account-lifecycle';
import { findAccountPerformance, accountExists as accountingAccountExists } from '@/db/accounting-repository';
import { computeReconciliation } from '@/lib/accounting/reconciliation';

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  broker: z.string().max(200).nullable().optional(),
  currency: z.string().min(1).max(3).optional(),
  isActive: z.boolean().optional(),
  maxRiskPerTradePct: z.number().positive().optional(),
  defaultCommission: z.number().min(0).optional(),
  startingBalance: z.number().min(0).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // 2. Fetch all closed trades for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(and(eq(trades.accountId, id), eq(trades.status, 'closed')))
      .all();

    // 3. Compute KPIs using shared library (legacy journal computation)
    let legacyKpis: { tradeCount: number; netPnl: number; winRate: number | null; avgR: number | null; avgGrade: number | null };
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
      legacyKpis = computeAccountKPIs(closedTrades, execByTradeId, riskSnapshots, grades);
    } else {
      legacyKpis = { tradeCount: 0, netPnl: 0, winRate: null, avgR: null, avgGrade: null };
    }

    // 4. Fetch account transactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .all();

    // 5. Delegate balance computation to shared library (legacy)
    const startingBalance = account.startingBalance ?? 0;
    const legacyBalance = computeAccountBalance(startingBalance, transactions, legacyKpis.netPnl);

    // ── 6. Fetch accounting ledger-derived metrics ───────────────────
    const sqlite = getSqliteHandle();
    let accountingProjection: Record<string, unknown> | null = null;
    let accountingRealizedPnl: string | null = null;
    let accountingNAV: string | null = null;
    let accountingIntegrity: Record<string, unknown> | null = null;

    try {
      const projection = findAccountPerformance(sqlite, id);
      if (projection) {
        accountingProjection = {
          netCash: projection.net_cash,
          nav: projection.nav,
          markedPositions: projection.marked_positions,
          realizedPnl: projection.realized_pnl,
          unrealizedPnl: projection.unrealized_pnl,
          totalPnl: projection.total_pnl,
          realizedFees: projection.realized_fees,
          grossExposure: projection.gross_exposure,
          netExposure: projection.net_exposure,
          modifiedDietzReturn: projection.modified_dietz_return,
          twr: projection.twr,
          highWaterMark: projection.high_water_mark,
          drawdown: projection.drawdown,
          drawdownPct: projection.drawdown_pct,
          computedAt: projection.computed_as_of,
          rebuildCount: projection.rebuild_count,
          lastRebuiltAt: projection.last_rebuilt_at,
        };
        accountingRealizedPnl = projection.realized_pnl;
        accountingNAV = projection.nav;
      }
    } catch {
      // Accounting projection fetch is best-effort
    }

    // ── 7. Reconciliation / integrity state ──────────────────────────
    try {
      const reconciliation = computeReconciliation(sqlite, id);
      if (reconciliation) {
        const status =
          reconciliation.cutoverEligible
            ? 'eligible'
            : reconciliation.totals.unexplained > 0
              ? 'blocked'
              : 'stale';
        accountingIntegrity = {
          status,
          cutoverEligible: reconciliation.cutoverEligible,
          cutoverRefusalReasons: reconciliation.cutoverRefusalReasons,
          totals: reconciliation.totals,
          runId: reconciliation.runId,
          runStatus: reconciliation.runStatus,
          computedAt: reconciliation.computedAt,
          recordStatusCounts: reconciliation.recordStatusCounts,
        };
      }
    } catch {
      // Reconciliation fetch is best-effort
    }

    // ── 8. Build response: active metrics from ledger when available ──
    const ledgerDerived = accountingProjection !== null;

    // Top-level currentBalance: use ledger NAV when projection exists
    const currentBalance = ledgerDerived && accountingNAV
      ? parseFloat(accountingNAV)
      : legacyBalance.currentBalance;

    // Top-level realizedPnl: use ledger value when projection exists
    const activeRealizedPnl = ledgerDerived && accountingRealizedPnl
      ? parseFloat(accountingRealizedPnl)
      : legacyBalance.realizedPnl;

    // KPIs: netPnl from ledger when projection exists; tradeCount/winRate/avgR/avgGrade stay legacy
    const activeKpis = {
      tradeCount: legacyKpis.tradeCount,
      netPnl: activeRealizedPnl,
      winRate: legacyKpis.winRate,
      avgR: legacyKpis.avgR,
      avgGrade: legacyKpis.avgGrade,
    };

    // ── 9. Build legacyAudit sub-object ──────────────────────────────
    const legacyAudit: Record<string, unknown> = {
      kpis: legacyKpis,
      realizedPnl: legacyBalance.realizedPnl,
      currentBalance: legacyBalance.currentBalance,
      netDeposits: legacyBalance.netDeposits,
      netWithdrawals: legacyBalance.netWithdrawals,
    };

    // ── 10. Return JSON with ledger-derived active metrics ───────────
    return NextResponse.json({
      ...account,
      currentBalance,
      realizedPnl: activeRealizedPnl,
      netDeposits: legacyBalance.netDeposits,
      netWithdrawals: legacyBalance.netWithdrawals,
      kpis: activeKpis,
      accounting: accountingProjection
        ? {
            projection: accountingProjection,
            realizedPnl: accountingRealizedPnl,
            nav: accountingNAV,
            ledgerDerived,
          }
        : { projection: null, realizedPnl: null, nav: null, ledgerDerived: false },
      accountingIntegrity,
      legacyAudit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch account', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const accountTrades = db.select({ status: trades.status }).from(trades).where(eq(trades.accountId, id)).all();

    if (parsed.data.isActive === false && !canDeactivateAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot deactivate account with open trades' },
        { status: 409 },
      );
    }

    if (parsed.data.isActive === true && !canReactivateAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot reactivate account with open trades' },
        { status: 409 },
      );
    }

    db.update(accounts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update account', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const accountTrades = db.select({ status: trades.status }).from(trades).where(eq(trades.accountId, id)).all();

    if (!canDeleteAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot delete account with any trade history' },
        { status: 409 },
      );
    }

    db.delete(accounts)
      .where(eq(accounts.id, id))
      .run();

    return NextResponse.json({ message: 'Account deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete account', details: String(error) },
      { status: 500 }
    );
  }
}
