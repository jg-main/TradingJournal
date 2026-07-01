/**
 * /api/dashboard route handler
 *
 * GET /api/dashboard?accountId=xxx
 *
 * Returns consolidated dashboard KPI metrics computed from real trade data.
 * Follows the batch-fetch pattern from /api/reviews/dashboard: multiple IN
 * queries to join related tables in application code, then passes them to
 * the pure-function computeKpiMetrics() library for aggregation.
 *
 * Error shape follows the standardized pattern from other route handlers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeExecutions, tradeGrades, tradeRiskSnapshots, accountRollforward, settings, accounts } from '@/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import {
  computeKpiMetrics,
  computeMonthlyPerformance,
  computeRDistribution,
  type KpiTradeInput,
  type RollforwardRow,
} from '@/lib/dashboard';
import {
  computeEquityCurve,
  computeDrawdown,
  type EquityDataPoint,
  type DrawdownDataPoint,
} from '@/lib/equity';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let accountId = searchParams.get('accountId');

    // Resolve account: provided param -> settings.defaultAccountId -> first active account
    if (!accountId) {
      const setting = db.select().from(settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId ?? null;
      } else {
        const firstActive = db
          .select()
          .from(accounts)
          .where(eq(accounts.isActive, true))
          .get();
        accountId = firstActive?.id ?? null;
      }
    }

    if (!accountId) {
      return NextResponse.json(
        {
          error: 'No active account found. Create an account first or set a default account in settings.',
          details: { fieldErrors: { accountId: ['No account resolved'] } },
        },
        { status: 400 },
      );
    }

    // 1. Fetch all trades for this account in a single query
    const allTrades = db
      .select()
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // 2. Separate closed trades from non-closed trades
    const closedTrades = allTrades.filter((t) => t.status === 'closed');
    const closedTradeIds = closedTrades.map((t) => t.id);

    // 3. Batch-fetch related data for ALL trade IDs (follows review-dashboard pattern)
    const executionsMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof tradeGrades.$inferSelect>();
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();

    if (allTradeIds.length > 0) {
      // Executions
      const execs = db
        .select()
        .from(tradeExecutions)
        .where(inArray(tradeExecutions.tradeId, allTradeIds))
        .all();
      for (const exec of execs) {
        const list = executionsMap.get(exec.tradeId) ?? [];
        list.push(exec);
        executionsMap.set(exec.tradeId, list);
      }

      // Grades
      const gradeRows = db
        .select()
        .from(tradeGrades)
        .where(inArray(tradeGrades.tradeId, allTradeIds))
        .all();
      for (const grade of gradeRows) {
        gradesMap.set(grade.tradeId, grade);
      }

      // Risk snapshots
      const snapshots = db
        .select()
        .from(tradeRiskSnapshots)
        .where(inArray(tradeRiskSnapshots.tradeId, allTradeIds))
        .all();
      for (const snap of snapshots) {
        riskMap.set(snap.tradeId, snap);
      }
    }

    // 4. Build KpiTradeInput array from ALL trades (allTrades for counts, closedTrades for P&L metrics)
    const closedKpiInputs: KpiTradeInput[] = closedTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
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
      closedAt: trade.closedAt ?? null,
    }));

    // Build all-trades KpiTradeInput for counts (non-closed trades have no P&L contribution)
    const allKpiInputs: KpiTradeInput[] = allTrades.map((trade) => ({
      id: trade.id,
      direction: trade.direction as 'long' | 'short',
      status: trade.status,
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
      closedAt: trade.closedAt ?? null,
    }));

    // 5. Fetch latest account_rollforward row for this account
    const rollforwardRow = db
      .select()
      .from(accountRollforward)
      .where(eq(accountRollforward.accountId, accountId))
      .orderBy(desc(accountRollforward.date))
      .limit(1)
      .get();

    const latestRollforward: RollforwardRow | null = rollforwardRow
      ? {
          date: rollforwardRow.date,
          endingEquity: rollforwardRow.endingEquity ?? 0,
          drawdownAmount: rollforwardRow.drawdownAmount ?? 0,
          drawdownPct: rollforwardRow.drawdownPct ?? 0,
          cumulativePnl: rollforwardRow.cumulativePnl ?? null,
          highWaterMark: rollforwardRow.highWaterMark ?? null,
        }
      : null;

    // 6. Fetch ALL account_rollforward rows ordered by date ASC for equity curve and drawdown charts
    const allRollforwardRows = db
      .select()
      .from(accountRollforward)
      .where(eq(accountRollforward.accountId, accountId))
      .orderBy(accountRollforward.date)
      .all();

    const rollforwardRowsForCharts: RollforwardRow[] = allRollforwardRows.map((r) => ({
      date: r.date,
      endingEquity: r.endingEquity ?? null,
      drawdownAmount: r.drawdownAmount ?? null,
      drawdownPct: r.drawdownPct ?? null,
      cumulativePnl: r.cumulativePnl ?? null,
      highWaterMark: r.highWaterMark ?? null,
    }));

    const equityCurve = computeEquityCurve(rollforwardRowsForCharts);
    const drawdown = computeDrawdown(rollforwardRowsForCharts);

    // 7. Fetch settings.startingAccountValue for fallback
    const setting = db.select().from(settings).get();
    const startingAccountValue = setting?.startingAccountValue ?? null;

    // 8. Compute KPIs
    const kpis = computeKpiMetrics(
      allKpiInputs,
      closedKpiInputs,
      latestRollforward,
      startingAccountValue,
    );

    // 9. Compute monthly performance and R distribution (pure, no DB queries)
    const monthlyPerformance = computeMonthlyPerformance(closedKpiInputs);
    const rDistribution = computeRDistribution(closedKpiInputs);

    return NextResponse.json({ kpis, equityCurve, drawdown, monthlyPerformance, rDistribution });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch dashboard KPIs', details: String(error) },
      { status: 500 },
    );
  }
}
