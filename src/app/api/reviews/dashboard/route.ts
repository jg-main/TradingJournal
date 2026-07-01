/**
 * reviews/dashboard route handler
 *
 * GET /api/reviews/dashboard?accountId=xxx
 *
 * Returns a dashboard payload with:
 *  - setupPerformance[]  Per-setup metrics from computeSetupPerformance()
 *  - totalTrades         Count of closed trades with non-null setupId
 *  - ungroupedTrades     Count of null-setupId trades (always 0 — pre-filtered)
 *  - mistakeFrequency[]  Mistakes grouped by type name with severity breakdown
 *  - ungradedTrades[]    Closed trades (with setupId) that have no grade row
 *
 * Follows the weekly-review batch-fetch pattern: multiple IN queries
 * to join related tables in application code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  trades,
  tradeExecutions,
  tradeGrades,
  tradeRiskSnapshots,
  tradeMistakes,
  lookupValues,
} from '@/db/schema';
import { eq, and, inArray, isNotNull } from 'drizzle-orm';
import { computeSetupPerformance, type SetupPerfTradeInput } from '@/lib/review-dashboard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json(
        { error: 'accountId is required' },
        { status: 400 },
      );
    }

    // 1. Select all closed trades with non-null setupId for this account
    const closedTrades = db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.accountId, accountId),
          eq(trades.status, 'closed'),
          isNotNull(trades.setupId),
        ),
      )
      .all();

    const tradeIds = closedTrades.map((t) => t.id);
    const setupIds = [
      ...new Set(closedTrades.map((t) => t.setupId).filter(Boolean)),
    ] as string[];

    // 2. Batch-fetch related data (follows weekly-review pattern)
    const executionsMap = new Map<
      string,
      (typeof tradeExecutions.$inferSelect)[]
    >();
    const gradesMap = new Map<string, typeof tradeGrades.$inferSelect>();
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
    const setupNameMap: Record<string, string> = {};

    if (tradeIds.length > 0) {
      // Executions
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

      // Grades
      const gradeRows = db
        .select()
        .from(tradeGrades)
        .where(inArray(tradeGrades.tradeId, tradeIds))
        .all();
      for (const grade of gradeRows) {
        gradesMap.set(grade.tradeId, grade);
      }

      // Risk snapshots
      const snapshots = db
        .select()
        .from(tradeRiskSnapshots)
        .where(inArray(tradeRiskSnapshots.tradeId, tradeIds))
        .all();
      for (const snap of snapshots) {
        riskMap.set(snap.tradeId, snap);
      }

      // Setup name lookups
      if (setupIds.length > 0) {
        const setupLookups = db
          .select()
          .from(lookupValues)
          .where(
            and(
              inArray(lookupValues.id, setupIds),
              eq(lookupValues.type, 'setup'),
            ),
          )
          .all();
        for (const lv of setupLookups) {
          setupNameMap[lv.id] = lv.value;
        }
      }
    }

    // 3. Build SetupPerfTradeInput array
    const perfInputs: SetupPerfTradeInput[] = closedTrades.map((trade) => ({
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
        ? {
            initialRiskAmount:
              riskMap.get(trade.id)!.initialRiskAmount ?? null,
          }
        : null,
      setupId: trade.setupId,
    }));

    // 4. Compute setup performance
    const dashboardMetrics = computeSetupPerformance(perfInputs, setupNameMap);

    // 5. Mistake frequency breakdown
    let mistakeFrequency: {
      mistakeType: string;
      minor: number;
      moderate: number;
      major: number;
      critical: number;
      total: number;
    }[] = [];

    if (tradeIds.length > 0) {
      const mistakes = db
        .select()
        .from(tradeMistakes)
        .where(inArray(tradeMistakes.tradeId, tradeIds))
        .all();

      if (mistakes.length > 0) {
        const mistakeTypeIds = [
          ...new Set(
            mistakes.map((m) => m.mistakeTypeId).filter(Boolean),
          ),
        ] as string[];

        const mistakeTypeNameMap: Record<string, string> = {};
        if (mistakeTypeIds.length > 0) {
          const typeLookups = db
            .select()
            .from(lookupValues)
            .where(
              and(
                inArray(lookupValues.id, mistakeTypeIds),
                eq(lookupValues.type, 'mistake_type'),
              ),
            )
            .all();
          for (const lv of typeLookups) {
            mistakeTypeNameMap[lv.id] = lv.value;
          }
        }

        const grouped = new Map<
          string,
          { minor: number; moderate: number; major: number; critical: number }
        >();

        for (const mistake of mistakes) {
          const typeName = mistake.mistakeTypeId
            ? mistakeTypeNameMap[mistake.mistakeTypeId] ?? mistake.mistakeTypeId
            : 'unknown';
          const entry = grouped.get(typeName) ?? {
            minor: 0,
            moderate: 0,
            major: 0,
            critical: 0,
          };
          const severity = mistake.severity as string;
          if (severity === 'minor') entry.minor++;
          else if (severity === 'moderate') entry.moderate++;
          else if (severity === 'major') entry.major++;
          else if (severity === 'critical') entry.critical++;
          grouped.set(typeName, entry);
        }

        mistakeFrequency = Array.from(grouped.entries())
          .map(([mistakeType, counts]) => ({
            mistakeType,
            ...counts,
            total:
              counts.minor +
              counts.moderate +
              counts.major +
              counts.critical,
          }))
          .sort((a, b) => b.total - a.total);
      }
    }

    // 6. Ungraded trades (closed with non-null setupId, no grade row)
    const ungradedTrades = closedTrades
      .filter((trade) => !gradesMap.has(trade.id))
      .map((trade) => ({
        id: trade.id,
        tradeCode: trade.tradeCode,
        symbol: trade.symbol,
        direction: trade.direction,
        closedAt: trade.closedAt,
      }));

    return NextResponse.json({
      setupPerformance: dashboardMetrics.setupPerformance,
      totalTrades: dashboardMetrics.totalTrades,
      ungroupedTrades: dashboardMetrics.ungroupedTrades,
      mistakeFrequency,
      ungradedTrades,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data', details: String(error) },
      { status: 500 },
    );
  }
}
