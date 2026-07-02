import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, accountTransactions, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount } from '@/lib/account-lifecycle';

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

    // 3. Compute realized P&L across closed trades
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

      // 3b. Compute per-account KPI metrics
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

    // 4. Fetch account transactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .all();

    const netDeposits = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((s, t) => s + t.amount, 0);

    const netWithdrawals = transactions
      .filter((t) => t.type === 'withdrawal')
      .reduce((s, t) => s + t.amount, 0);

    // 5. Compute current balance
    const startingBalance = account.startingBalance ?? 0;
    const currentBalance = startingBalance + netDeposits - netWithdrawals + realizedPnl;

    // 6. Return JSON with account fields plus rollforward data
    return NextResponse.json({
      ...account,
      currentBalance,
      realizedPnl,
      netDeposits,
      netWithdrawals,
      kpis,
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
