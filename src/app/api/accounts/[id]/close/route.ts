import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, accountTransactions, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';
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

    // 2. Fetch account base fields
    const startingBalance = account.startingBalance ?? 0;
    const accountCreatedAt = account.createdAt ?? new Date().toISOString();

    // 3. Query all closed trades for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(and(eq(trades.accountId, id), eq(trades.status, 'closed')))
      .all();

    // 4. Compute realized P&L and KPIs
    let realizedPnl = 0;
    let kpis = {
      tradeCount: 0,
      netPnl: 0,
      winRate: null as number | null,
      avgR: null as number | null,
      avgGrade: null as number | null,
    };

    if (closedTrades.length > 0) {
      const tradeIds = closedTrades.map((t) => t.id);

      // Fetch all executions for the closed trades in one query
      const allExecutions = db
        .select()
        .from(tradeExecutions)
        .where(inArray(tradeExecutions.tradeId, tradeIds))
        .all();

      // Group executions by tradeId
      type ExecType = (typeof allExecutions)[number];
      const execByTradeId = new Map<string, ExecType[]>();
      for (const exec of allExecutions) {
        const list = execByTradeId.get(exec.tradeId) ?? [];
        list.push(exec);
        execByTradeId.set(exec.tradeId, list);
      }

      // Compute P&L for each closed trade
      for (const trade of closedTrades) {
        const executions = execByTradeId.get(trade.id) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees ?? 0,
          executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction);
        realizedPnl += pnl.totalRealizedPnL;
      }

      // Compute per-account KPI metrics
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

      const riskByTradeId = new Map(riskSnapshots.map((rs) => [rs.tradeId, rs]));
      const gradeByTradeId = new Map(grades.map((g) => [g.tradeId, g]));

      let winCount = 0;
      let netPnlForKpis = 0;
      const rMultiples: number[] = [];
      const gradeScores: number[] = [];

      for (const trade of closedTrades) {
        const executions = execByTradeId.get(trade.id) ?? [];
        if (executions.length === 0) continue;

        const execData: ExecutionData[] = executions.map((e) => ({
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees ?? 0,
          executedAt: e.executedAt ?? trade.createdAt ?? new Date().toISOString(),
        }));

        const pnl = calculatePnL(execData, trade.direction);
        netPnlForKpis += pnl.totalRealizedPnL;

        // R-multiple from risk snapshot
        const risk = riskByTradeId.get(trade.id);
        if (risk?.initialRiskAmount != null && risk.initialRiskAmount > 0) {
          const rResult = calculateRMultiple(pnl.totalRealizedPnL, risk.initialRiskAmount);
          if (rResult.rMultiple !== null) rMultiples.push(rResult.rMultiple);
        }

        // Grade score
        const grade = gradeByTradeId.get(trade.id);
        if (grade?.totalScore != null) gradeScores.push(grade.totalScore);

        // Win/loss
        if (pnl.totalRealizedPnL > 0) winCount++;
      }

      const decisions = closedTrades.filter(
        (t) => (execByTradeId.get(t.id)?.length ?? 0) > 0,
      ).length;

      kpis = {
        tradeCount: closedTrades.length,
        netPnl: netPnlForKpis,
        winRate: decisions > 0 ? winCount / decisions : null,
        avgR: rMultiples.length > 0
          ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
          : null,
        avgGrade: gradeScores.length > 0
          ? gradeScores.reduce((a, b) => a + b, 0) / gradeScores.length
          : null,
      };
    }

    // 5. Query accountTransactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .all();

    const depositsTotal = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((s, t) => s + t.amount, 0);

    const withdrawalsTotal = transactions
      .filter((t) => t.type === 'withdrawal')
      .reduce((s, t) => s + t.amount, 0);

    // 6. Compute final balance and net return
    const finalBalance = startingBalance + depositsTotal - withdrawalsTotal + realizedPnl;
    const netReturn = depositsTotal > 0
      ? (realizedPnl / depositsTotal) * 100
      : null;

    // 7. Compute datesActive
    const transactionDates = transactions
      .filter((t) => t.date != null)
      .map((t) => t.date as string)
      .sort();

    const earliestDate = transactionDates.length > 0
      ? new Date(Math.min(
          new Date(accountCreatedAt).getTime(),
          ...transactionDates.map((d) => new Date(d).getTime()),
        )).toISOString()
      : accountCreatedAt;

    const datesActive = {
      from: earliestDate,
      to: new Date().toISOString(),
    };

    // 8. Deactivate the account
    db.update(accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    // 9. Return closure summary JSON
    return NextResponse.json({
      accountId: id,
      accountName: account.name,
      startingBalance,
      depositsTotal,
      withdrawalsTotal,
      realizedPnl,
      finalBalance,
      netReturn,
      kpis,
      datesActive,
      closedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to close account', details: String(error) },
      { status: 500 },
    );
  }
}
