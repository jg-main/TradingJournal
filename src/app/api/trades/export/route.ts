/**
 * /api/trades/export route handler
 *
 * GET /api/trades/export?accountId=xxx
 *
 * Exports all trades (including their executions, grades, mistakes, risk
 * snapshots, and stop adjustments) as a downloadable CSV file.
 *
 * Follows the batch-fetch pattern from /api/dashboard: multiple IN queries
 * to join related tables in application code, then passes them to the
 * pure-function exportTradesToCsv() library for serialisation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  trades,
  tradeExecutions,
  tradeGrades,
  tradeMistakes,
  tradeRiskSnapshots,
  tradeStopAdjustments,
  lookupValues,
  settings,
  accounts,
} from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { calculatePnL, calculateRMultiple, type ExecutionData } from '@/lib/trade-calc';
import { exportTradesToCsv, type ExportTradeRow } from '@/lib/export-csv';

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

    // 1. Fetch all trades for this account
    const allTrades = db
      .select()
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // 2. Batch-fetch related data
    const executionsMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof tradeGrades.$inferSelect>();
    const mistakesMap = new Map<string, (typeof tradeMistakes.$inferSelect)[]>();
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
    const stopAdjustmentsMap = new Map<string, (typeof tradeStopAdjustments.$inferSelect)[]>();

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

      // Mistakes
      const mistakeRows = db
        .select()
        .from(tradeMistakes)
        .where(inArray(tradeMistakes.tradeId, allTradeIds))
        .all();
      for (const mistake of mistakeRows) {
        const list = mistakesMap.get(mistake.tradeId) ?? [];
        list.push(mistake);
        mistakesMap.set(mistake.tradeId, list);
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

      // Stop adjustments
      const adjustments = db
        .select()
        .from(tradeStopAdjustments)
        .where(inArray(tradeStopAdjustments.tradeId, allTradeIds))
        .all();
      for (const adj of adjustments) {
        const list = stopAdjustmentsMap.get(adj.tradeId) ?? [];
        list.push(adj);
        stopAdjustmentsMap.set(adj.tradeId, list);
      }
    }

    // 3. Resolve lookup names (setup, sector, marketCondition)
    const lookupIdSet = new Set<string>();
    for (const t of allTrades) {
      if (t.sectorId) lookupIdSet.add(t.sectorId);
      if (t.setupId) lookupIdSet.add(t.setupId);
      if (t.marketConditionId) lookupIdSet.add(t.marketConditionId);
    }
    const lookupIds = [...lookupIdSet];
    const lookupMap = new Map<string, string>();
    if (lookupIds.length > 0) {
      const lookupRows = db
        .select()
        .from(lookupValues)
        .where(inArray(lookupValues.id, lookupIds))
        .all();
      for (const lv of lookupRows) {
        lookupMap.set(lv.id, lv.value);
      }
    }

    // 4. Build ExportTradeRow array
    const exportRows: ExportTradeRow[] = allTrades.map((trade) => {
      const tradeExecs = executionsMap.get(trade.id) ?? [];

      // Convert Drizzle executions to ExecutionData for trade-calc
      const executionData: ExecutionData[] = tradeExecs.map((ex) => ({
        action: ex.action,
        quantity: ex.quantity,
        price: ex.price,
        fees: ex.fees ?? null,
        executedAt: ex.executedAt ?? '',
      }));

      // Compute P&L
      const pnl = calculatePnL(executionData, trade.direction as 'long' | 'short');
      const totalFees = executionData.reduce((s, e) => s + (e.fees ?? 0), 0);

      // Compute R multiple
      const riskSnap = riskMap.get(trade.id);
      const initialRiskAmount = riskSnap?.initialRiskAmount ?? null;
      const { rMultiple } = calculateRMultiple(pnl.totalRealizedPnL, initialRiskAmount);

      // Grade data
      const grade = gradesMap.get(trade.id);

      return {
        // Trade identity
        tradeCode: trade.tradeCode,
        symbol: trade.symbol,
        direction: trade.direction,
        status: trade.status,

        // Lookup names (resolved from IDs)
        setup: trade.setupId ? (lookupMap.get(trade.setupId) ?? null) : null,
        sector: trade.sectorId ? (lookupMap.get(trade.sectorId) ?? null) : null,
        marketCondition: trade.marketConditionId ? (lookupMap.get(trade.marketConditionId) ?? null) : null,

        // Planned values
        plannedEntry: trade.plannedEntry ?? null,
        plannedStop: trade.plannedStop ?? null,
        plannedTarget1: trade.plannedTarget1 ?? null,

        // Trade narrative
        thesis: trade.thesis ?? null,
        invalidationCondition: trade.invalidationCondition ?? null,
        preTradePlan: trade.preTradePlan ?? null,
        exitNotes: trade.exitNotes ?? null,
        lesson: trade.lesson ?? null,

        // Timing
        openedAt: trade.openedAt ?? null,
        closedAt: trade.closedAt ?? null,
        createdAt: trade.createdAt ?? null,
        updatedAt: trade.updatedAt ?? null,

        // Computed P&L
        realizedPnL: pnl.totalRealizedPnL,
        rMultiple,
        avgEntryPrice: pnl.avgEntryPrice,
        totalEntryQty: pnl.totalEntryQty,
        totalExitQty: pnl.totalExitQty,
        openQuantity: pnl.openQuantity,
        totalFees,

        // Grade scores
        setupQualityScore: grade?.setupQualityScore ?? null,
        riskQualityScore: grade?.riskQualityScore ?? null,
        entryQualityScore: grade?.entryQualityScore ?? null,
        managementQualityScore: grade?.managementQualityScore ?? null,
        exitQualityScore: grade?.exitQualityScore ?? null,
        reviewQualityScore: grade?.reviewQualityScore ?? null,
        totalScore: grade?.totalScore ?? null,
        gradeLabel: grade?.gradeLabel ?? null,
        followedPlan: grade?.followedPlan ?? null,
        ruleViolation: grade?.ruleViolation ?? null,
        gradeNotes: grade?.notes ?? null,

        // Risk assessment
        initialRiskAmount: riskSnap?.initialRiskAmount ?? null,
        accountRiskPct: riskSnap?.accountRiskPct ?? null,

        // Child record counts
        executionCount: tradeExecs.length,
        mistakeCount: (mistakesMap.get(trade.id) ?? []).length,
        stopAdjustmentCount: (stopAdjustmentsMap.get(trade.id) ?? []).length,
      };
    });

    // 5. Generate CSV and return as downloadable file
    const csv = exportTradesToCsv(exportRows);

    const filename = `trades-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to export trades', details: String(error) },
      { status: 500 },
    );
  }
}
