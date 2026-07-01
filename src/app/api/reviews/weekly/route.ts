import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions, tradeGrades, tradeRiskSnapshots, weeklyReviews } from '@/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { computeWeeklyMetrics, type WeekReviewTradeInput } from '@/lib/weekly-review';

const generateSchema = z.object({
  weekStart: z.string().trim().min(1, 'weekStart is required'),
  accountId: z.string().trim().min(1, 'accountId is required'),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    const conditions: ReturnType<typeof eq>[] = [];

    if (accountId) {
      conditions.push(eq(weeklyReviews.accountId, accountId));
    }

    const query = db
      .select()
      .from(weeklyReviews)
      .orderBy(weeklyReviews.weekStart);

    const items =
      conditions.length > 0
        ? query.where(and(...conditions)).all()
        : query.all();

    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch weekly reviews', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = generateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    const { weekStart: rawWeekStart, accountId } = parsed.data;

    // Compute weekStart (Monday) ISO date and weekEnd (Sunday) ISO date
    const startDate = new Date(rawWeekStart);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 6);
    endDate.setUTCHours(23, 59, 59, 999);

    const weekStart = startDate.toISOString().split('T')[0];
    const weekEnd = endDate.toISOString().split('T')[0];

    const weekStartISO = startDate.toISOString();
    const weekEndISO = endDate.toISOString();

    // Fetch closed trades in range for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.accountId, accountId),
          eq(trades.status, 'closed'),
          gte(trades.closedAt, weekStartISO),
          lte(trades.closedAt, weekEndISO),
        ),
      )
      .all();

    const tradeIds = closedTrades.map((t) => t.id);

    // Batch fetch related data
    const executionsMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof tradeGrades.$inferSelect>();
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();

    if (tradeIds.length > 0) {
      const execs = db
        .select()
        .from(tradeExecutions)
        .where(inArray(tradeExecutions.tradeId, tradeIds))
        .all();

      for (const exec of execs) {
        const list = executionsMap.get(exec.tradeId) ?? [];
        list.push(exec);
        executionsMap.set(exec.tradeId, list);
      }

      const gradeRows = db
        .select()
        .from(tradeGrades)
        .where(inArray(tradeGrades.tradeId, tradeIds))
        .all();

      for (const grade of gradeRows) {
        gradesMap.set(grade.tradeId, grade);
      }

      const snapshots = db
        .select()
        .from(tradeRiskSnapshots)
        .where(inArray(tradeRiskSnapshots.tradeId, tradeIds))
        .all();

      for (const snap of snapshots) {
        riskMap.set(snap.tradeId, snap);
      }
    }

    // Convert to WeekReviewTradeInput[]
    const reviewInputs: WeekReviewTradeInput[] = closedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      executions: (executionsMap.get(trade.id) ?? []).map((ex) => ({
        action: ex.action,
        quantity: ex.quantity,
        price: ex.price,
        fees: ex.fees ?? null,
        executedAt: ex.executedAt ?? '',
      })),
      grade: (() => {
        const gradeRow = gradesMap.get(trade.id);
        const totalScore = gradeRow?.totalScore;
        return totalScore != null ? { totalScore } : null;
      })(),
      riskSnapshot: riskMap.has(trade.id)
        ? { initialRiskAmount: riskMap.get(trade.id)!.initialRiskAmount ?? null }
        : null,
    }));

    // Compute aggregated metrics
    const metrics = computeWeeklyMetrics(reviewInputs);

    // Upsert with onConflictDoUpdate on (accountId, weekStart, weekEnd)
    const now = new Date().toISOString();
    const reviewId = randomUUID();

    db.insert(weeklyReviews)
      .values({
        id: reviewId,
        weekStart,
        weekEnd,
        accountId,
        closedTrades: metrics.closedTrades,
        netPnl: metrics.netPnl,
        avgR: metrics.avgR ?? null,
        winRate: metrics.winRate,
        avgProcessScore: metrics.avgProcessScore ?? null,
        notes: null,
        focusNextWeek: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [weeklyReviews.accountId, weeklyReviews.weekStart, weeklyReviews.weekEnd],
        set: {
          closedTrades: metrics.closedTrades,
          netPnl: metrics.netPnl,
          avgR: metrics.avgR ?? null,
          winRate: metrics.winRate,
          avgProcessScore: metrics.avgProcessScore ?? null,
          updatedAt: now,
        },
      })
      .run();

    // Fetch the row after upsert (use unique key in case of conflict)
    const row = db
      .select()
      .from(weeklyReviews)
      .where(
        and(
          eq(weeklyReviews.accountId, accountId),
          eq(weeklyReviews.weekStart, weekStart),
          eq(weeklyReviews.weekEnd, weekEnd),
        ),
      )
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate weekly review', details: String(error) },
      { status: 500 },
    );
  }
}
