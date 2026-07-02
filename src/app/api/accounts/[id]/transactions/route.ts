import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, accountTransactions } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

const createTransactionSchema = z.object({
  type: z.enum(['deposit', 'withdrawal']),
  amount: z.number().positive('Amount must be positive'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes: z.string().nullable().optional(),
});

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

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

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

    // Compute current balance
    const balanceResult = db
      .select({
        totalDeposits: sql<number>`COALESCE(SUM(CASE WHEN ${accountTransactions.type} = 'deposit' THEN ${accountTransactions.amount} ELSE 0 END), 0)`,
        totalWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${accountTransactions.type} = 'withdrawal' THEN ${accountTransactions.amount} ELSE 0 END), 0)`,
      })
      .from(accountTransactions)
      .where(eq(accountTransactions.accountId, id))
      .get();

    const currentBalance = (balanceResult?.totalDeposits ?? 0) - (balanceResult?.totalWithdrawals ?? 0);

    // Validate withdrawal doesn't exceed balance
    if (parsed.data.type === 'withdrawal' && parsed.data.amount > currentBalance) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              amount: [`Withdrawal of $${parsed.data.amount.toFixed(2)} exceeds current balance of $${currentBalance.toFixed(2)}`],
            },
          },
        },
        { status: 400 }
      );
    }

    const transactionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Compute balanceAfter
    const balanceAfter = parsed.data.type === 'deposit'
      ? currentBalance + parsed.data.amount
      : currentBalance - parsed.data.amount;

    db.insert(accountTransactions)
      .values({
        id: transactionId,
        accountId: id,
        type: parsed.data.type,
        amount: parsed.data.amount,
        balanceAfter,
        date: parsed.data.date ?? now.split('T')[0],
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    const row = db
      .select()
      .from(accountTransactions)
      .where(eq(accountTransactions.id, transactionId))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create transaction', details: String(error) },
      { status: 500 }
    );
  }
}
