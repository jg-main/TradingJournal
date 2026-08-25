import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, accountTransactions } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Verify account exists
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Get all transactions ordered by date desc
    const transactions = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .orderBy(desc(accountTransactions.date), desc(accountTransactions.createdAt))
      .all();

    // Compute current balance from all transactions
    const balanceResult = db
      .select({
        totalDeposits: sql<number>`COALESCE(SUM(CASE WHEN ${accountTransactions.type} = 'deposit' THEN ${accountTransactions.amount} ELSE 0 END), 0)`,
        totalWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${accountTransactions.type} = 'withdrawal' THEN ${accountTransactions.amount} ELSE 0 END), 0)`,
      })
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .get();

    const currentBalance = (balanceResult?.totalDeposits ?? 0) - (balanceResult?.totalWithdrawals ?? 0);

    return NextResponse.json({
      data: transactions,
      currentBalance,
      accountName: account.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST is retired. Cash activity must go through the canonical accounting
 * kernel at POST /api/accounts/:id/financial-events (postFinancialEvent).
 * Returns 410 Gone so stale callers get a clear diagnostic instead of a
 * silent 404 or 500, and never touches account_transactions.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Retired',
      message: 'This endpoint is retired. Use POST /api/accounts/:id/financial-events for cash activity.',
    },
    { status: 410 }
  );
}
