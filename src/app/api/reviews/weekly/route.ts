import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions, tradeGrades, tradeRiskSnapshots, weeklyReviews } from '@/db/schema';
import { eq, and, gte, lt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { computeWeeklyMetrics, type WeekReviewTradeInput } from '@/lib/weekly-review';
import { getConfiguredTimezone } from '@/lib/app-profile-server';
import { addLocalDays, localDateStartToUtc } from '@/lib/timezone';

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

    // D8: the trader's week is defined by LOCAL calendar boundaries in the
    // configured app timezone — Monday 00:00 local through next Monday
    // 00:00 local. The DB query compares absolute timestamps against the
    // UTC instants corresponding to those LOCAL boundaries (half-open:
    // >= startUtc, < endExclusiveUtc), so DST and offset changes are
    // handled correctly.
    const timezone = getConfiguredTimezone();
    const weekStartKey = rawWeekStart; // local Monday YYYY-MM-DD
    const weekEndKey = addLocalDays(weekStartKey, 6); // local Sunday YYYY-MM-DD

    const weekStartISO = localDateStartToUtc(weekStartKey, timezone);
    const weekEndISO = localDateStartToUtc(addLocalDays(weekStartKey, 7), timezone);

    const weekStart = weekStartKey;
    const weekEnd = weekEndKey;

    // Fetch closed trades in [local Monday 00:00, next local Monday 00:00)
    const closedTrades = db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.accountId, accountId),
          eq(trades.status, 'closed'),
          gte(trades.closedAt, weekStartISO),
          lt(trades.closedAt, weekEndISO),
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
