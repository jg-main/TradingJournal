import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, accountTransactions, tradeExecutions, trades, tradeRiskSnapshots, tradeGrades } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type ExecutionData } from '@/lib/trade-calc';
import { computeAccountKPIs, computeAccountBalance } from '@/lib/account-summary';
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

    // 3. Compute KPIs using shared library
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

    // 4. Fetch account transactions for deposits/withdrawals
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .all();

    // 5. Delegate balance computation to shared library
    const startingBalance = account.startingBalance ?? 0;
    const balance = computeAccountBalance(startingBalance, transactions, kpis.netPnl);

    // 6. Return JSON with account fields plus rollforward data
    return NextResponse.json({
      ...account,
      ...balance,
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
