import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, settings, accounts, lookupValues, setupDefinitions, tradeRiskSnapshots, tradeExecutions, tradeStopAdjustments, accountRollforward } from '@/db/schema';
import { eq, and, desc, sql, inArray, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput, TradeListMetrics } from '@/lib/trade-metrics';

const createTradeSchema = z.object({
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  direction: z.enum(['long', 'short']),
  accountId: z.string().uuid().optional(),
  setup: z.string().nullable().optional(),
  setupId: z.string().uuid().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedQuantity: z.number().nullable().optional(),

  invalidationCondition: z.string().nullable().optional(),
  preTradePlan: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    type TradeStatus = 'planned' | 'open' | 'closed' | 'deleted';

    // Parse filter params
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const accountIdFilter = searchParams.get('accountId');
    const directionFilter = searchParams.get('direction');

    // Validate date params with zod if present
    if (from) {
      const parsed = z.string().datetime({ offset: true }).or(z.string().datetime()).safeParse(from);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'from must be a valid ISO 8601 date string' },
          { status: 400 }
        );
      }
    }
    if (to) {
      const parsed = z.string().datetime({ offset: true }).or(z.string().datetime()).safeParse(to);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'to must be a valid ISO 8601 date string' },
          { status: 400 }
        );
      }
    }

    // Build filters array (conditions that narrow the result set)
    const filters: any[] = [];

    if (status) {
      filters.push(eq(trades.status, status as TradeStatus));
    }
    // Status-aware date filtering
    // open → date filters ignored (all open positions visible regardless of date)
    // closed → filter by closedAt
    // planned → filter by createdAt
    // default (no status or other) → filter by openedAt (backward compatible)
    const dateColumn = status === 'closed'
      ? trades.closedAt
      : status === 'planned'
        ? trades.createdAt
        : trades.openedAt;

    if (status === 'open') {
      if (from || to) {
        console.warn('[trades GET] Date range filters ignored for status=open — open positions are always visible');
      }
    } else {
      if (from) {
        filters.push(gte(dateColumn, from));
      }
      if (to) {
        filters.push(lte(dateColumn, to));
      }
    }
    if (accountIdFilter) {
      filters.push(eq(trades.accountId, accountIdFilter));
    }
    if (directionFilter) {
      if (!['long', 'short'].includes(directionFilter)) {
        return NextResponse.json(
          { error: 'Validation failed', details: 'direction must be "long" or "short"' },
          { status: 400 }
        );
      }
      filters.push(eq(trades.direction, directionFilter as 'long' | 'short'));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Total count
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(whereClause)
      .get();

    const total = countResult?.count ?? 0;

    // Paginated data with setup name from lookup values
    const rows = db
      .select({
        id: trades.id,
        tradeCode: trades.tradeCode,
        accountId: trades.accountId,
        symbol: trades.symbol,
        direction: trades.direction,
        setupId: trades.setupId,
        // Prefer setupDefinitions.name (preserves original case), fall back to lookupValues.value
        setupName: sql<string | null>`COALESCE(${setupDefinitions.name}, ${lookupValues.value})`,
        sectorId: trades.sectorId,
        marketConditionId: trades.marketConditionId,
        status: trades.status,
        thesis: trades.thesis,
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedTarget1: trades.plannedTarget1,
        plannedQuantity: trades.plannedQuantity,

        invalidationCondition: trades.invalidationCondition,
        preTradePlan: trades.preTradePlan,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        currentPrice: trades.currentPrice,
        // NOTE: AVG(price) SQL subqueries removed — actualEntry and avgExitPrice
        // are now computed via computeTradeMetrics().averagePrices in the enriched rows below.
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
        currentPriceFetchedAt: trades.currentPriceFetchedAt,
        // NOTE: riskPct removed from SQL — now computed via metrics.risk.riskToAccount
      })
      .from(trades)
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .where(whereClause)
      .orderBy(desc(trades.openedAt), desc(trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Batch-fetch related data for all returned trades
    const tradeIds = rows.map((r) => r.id);

    const execRows = tradeIds.length > 0
      ? db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, tradeIds)).all()
      : [];
    const riskRows = tradeIds.length > 0
      ? db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, tradeIds)).all()
      : [];
    const stopRows = tradeIds.length > 0
      ? db.select().from(tradeStopAdjustments).where(inArray(tradeStopAdjustments.tradeId, tradeIds)).all()
      : [];

    // Group by trade ID
    const execMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push(ex);
      execMap.set(ex.tradeId, list);
    }
    const riskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
    for (const risk of riskRows) {
      riskMap.set(risk.tradeId, risk);
    }
    const stopMap = new Map<string, (typeof tradeStopAdjustments.$inferSelect)[]>();
    for (const stop of stopRows) {
      const list = stopMap.get(stop.tradeId) ?? [];
      list.push(stop);
      stopMap.set(stop.tradeId, list);
    }

    // Batch-fetch accounts for equity cascade per account
    const uniqueAccountIds = [...new Set(rows.map((r) => r.accountId))];
    const accountRows = db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, uniqueAccountIds))
      .all();
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));

    // Batch-fetch latest account_rollforward per unique account — endingEquity is
    // the primary source for current account equity (more accurate than startingBalance).
    const latestRollforwardMap = new Map<string, typeof accountRollforward.$inferSelect>();
    for (const accId of uniqueAccountIds) {
      if (!accId) continue;
      const rf = db
        .select()
        .from(accountRollforward)
        .where(eq(accountRollforward.accountId, accId))
        .orderBy(desc(accountRollforward.date))
        .limit(1)
        .get();
      if (rf) {
        latestRollforwardMap.set(accId, rf);
      }
    }

    // Single settings row for equity fallback
    const settingsRow = db
      .select()
      .from(settings)
      .where(eq(settings.id, 'default'))
      .get();

    // Compute enhanced rows with computeTradeMetrics()
    const enhancedRows = rows.map((row) => {
      const executions = execMap.get(row.id) ?? [];
      const riskSnapshot = riskMap.get(row.id) ?? null;
      const stopAdjustments = stopMap.get(row.id) ?? [];

      // Account equity cascade: latest rollforward.endingEquity → account.startingBalance → settings.startingAccountValue → null
      const account = accountMap.get(row.accountId);
      const latestRollforward = latestRollforwardMap.get(row.accountId);
      const currentAccountEquity =
        latestRollforward?.endingEquity ??
        account?.startingBalance ??
        settingsRow?.startingAccountValue ??
        null;

      const metricsInput: TradeMetricsInput = {
        executions: executions.map((e) => ({
          id: e.id,
          action: e.action,
          quantity: e.quantity,
          price: e.price,
          fees: e.fees,
          executedAt: e.executedAt ?? '',
        })),
        direction: row.direction as 'long' | 'short',
        riskSnapshot: riskSnapshot
          ? {
              initialRiskAmount: riskSnapshot.initialRiskAmount,
              accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
            }
          : null,
        stopAdjustments: stopAdjustments
          .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
          .map((s) => ({
            stopPrice: s.newStop,
            adjustedAt: s.adjustedAt ?? '',
          })),
        currentMark:
          row.currentPrice != null
            ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
            : null,
        currentAccountEquity,
      };

      const metrics = computeTradeMetrics(metricsInput);

      // Compute planned risk-to-account for planned trades
      // Planned risk = |plannedEntry - plannedStop| * plannedQuantity
      // as percentage of current account equity
      let plannedRiskToAccount: number | null = null;
      if (
        row.status === 'planned' &&
        row.plannedEntry != null &&
        row.plannedStop != null &&
        row.plannedQuantity != null &&
        row.plannedQuantity > 0 &&
        currentAccountEquity != null &&
        currentAccountEquity > 0
      ) {
        const plannedRiskAmount = Math.abs(row.plannedEntry - row.plannedStop) * row.plannedQuantity;
        plannedRiskToAccount = (plannedRiskAmount / currentAccountEquity) * 100;
      }

      // Strip FIFO debugging detail for the list view; full metrics remain available
      // for the trade-detail endpoint via GET /api/trades/[id]
      const { remainingLots: _remainingLots, matches: _matches, ...metricsForList } = metrics;

      // Backward-compatible flat fields + compact nested metrics
      return {
        ...row,
        realizedPnl: metrics.realizedPnl.netRealizedPnl,
        unrealizedPnl: metrics.unrealizedPnl.netUnrealizedPnl,
        returnPct: metrics.returnMetrics.returnPct,
        riskPct: metrics.risk.riskToAccount,
        plannedRiskToAccount,
        metrics: metricsForList satisfies TradeListMetrics,
      };
    });

    // ── Server-computed totals: aggregate across the full filtered dataset, NOT just the current page ──

    // Get all matching trade IDs (no pagination) for full-dataset aggregation
    const allMatchingIdsR = db
      .select({
        id: trades.id,
        accountId: trades.accountId,
        symbol: trades.symbol,
        direction: trades.direction,
        currentPrice: trades.currentPrice,
        currentPriceFetchedAt: trades.currentPriceFetchedAt,
      })
      .from(trades)
      .where(whereClause)
      .all();

    let fullTotals: Record<string, number> = {
      grossRealizedPnl: 0,
      netRealizedPnl: 0,
      totalFees: 0,
      grossUnrealizedPnl: 0,
      netUnrealizedPnl: 0,
      totalOpenRisk: 0,
    };

    // Per-currency totals buckets — hoisted outside the if-block for response access
    const totalsByCurrency: Record<
      string,
      {
        grossRealizedPnl: number;
        netRealizedPnl: number;
        totalFees: number;
        grossUnrealizedPnl: number;
        netUnrealizedPnl: number;
        totalOpenRisk: number;
        portfolioHeat: number;
      }
    > = {};

    if (allMatchingIdsR.length > 0) {
      const allTradeIds = allMatchingIdsR.map((r) => r.id);
      const allUniqueAccountIds = [...new Set(allMatchingIdsR.map((r) => r.accountId))];

      // Batch-fetch related data for ALL matching trades
      const allExecRows = db.select().from(tradeExecutions).where(inArray(tradeExecutions.tradeId, allTradeIds)).all();
      const allRiskRows = db.select().from(tradeRiskSnapshots).where(inArray(tradeRiskSnapshots.tradeId, allTradeIds)).all();
      const allStopRows = db.select().from(tradeStopAdjustments).where(inArray(tradeStopAdjustments.tradeId, allTradeIds)).all();

      const allExecMap = new Map<string, (typeof tradeExecutions.$inferSelect)[]>();
      for (const ex of allExecRows) {
        const list = allExecMap.get(ex.tradeId) ?? [];
        list.push(ex);
        allExecMap.set(ex.tradeId, list);
      }
      const allRiskMap = new Map<string, typeof tradeRiskSnapshots.$inferSelect>();
      for (const risk of allRiskRows) {
        allRiskMap.set(risk.tradeId, risk);
      }
      const allStopMap = new Map<string, (typeof tradeStopAdjustments.$inferSelect)[]>();
      for (const stop of allStopRows) {
        const list = allStopMap.get(stop.tradeId) ?? [];
        list.push(stop);
        allStopMap.set(stop.tradeId, list);
      }

      const allAccountRows = db
        .select()
        .from(accounts)
        .where(inArray(accounts.id, allUniqueAccountIds.filter(Boolean)))
        .all();
      const allAccountMap = new Map(allAccountRows.map((a) => [a.id, a]));
      const allAccountCurrencyMap = new Map(allAccountRows.map((a) => [a.id, a.currency ?? 'USD']));

      // Batch-fetch latest rollforward per account for totals computation
      const allLatestRollforwardMap = new Map<string, typeof accountRollforward.$inferSelect>();
      for (const accId of allUniqueAccountIds) {
        if (!accId) continue;
        const rf = db
          .select()
          .from(accountRollforward)
          .where(eq(accountRollforward.accountId, accId))
          .orderBy(desc(accountRollforward.date))
          .limit(1)
          .get();
        if (rf) {
          allLatestRollforwardMap.set(accId, rf);
        }
      }

      // Track unique account equities for portfolioHeat denominator
      // (one equity per account to avoid double-counting)
      const totalEquityByAccount = new Map<string, number>();
      const currencyEquityByAccount = new Map<string, Map<string, number>>();

      // Compute metrics for every matching trade and aggregate
      fullTotals = allMatchingIdsR.reduce(
        (acc, row) => {
          const executions = allExecMap.get(row.id) ?? [];
          const riskSnapshot = allRiskMap.get(row.id) ?? null;
          const stopAdjustments = allStopMap.get(row.id) ?? [];
          const account = allAccountMap.get(row.accountId);
          const latestRollforward = allLatestRollforwardMap.get(row.accountId);
          const currentAccountEquity =
            latestRollforward?.endingEquity ??
            account?.startingBalance ??
            settingsRow?.startingAccountValue ??
            null;

          const metricsInput: TradeMetricsInput = {
            executions: executions.map((e) => ({
              id: e.id,
              action: e.action,
              quantity: e.quantity,
              price: e.price,
              fees: e.fees,
              executedAt: e.executedAt ?? '',
            })),
            direction: row.direction as 'long' | 'short',
            riskSnapshot: riskSnapshot
              ? {
                  initialRiskAmount: riskSnapshot.initialRiskAmount,
                  accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
                }
              : null,
            stopAdjustments: stopAdjustments
              .filter((s): s is typeof s & { newStop: number } => s.newStop != null)
              .map((s) => ({ stopPrice: s.newStop, adjustedAt: s.adjustedAt ?? '' })),
            currentMark:
              row.currentPrice != null
                ? { price: row.currentPrice, markedAt: row.currentPriceFetchedAt ?? new Date().toISOString() }
                : null,
            currentAccountEquity,
          };

          const metrics = computeTradeMetrics(metricsInput);

          const currency = allAccountCurrencyMap.get(row.accountId) ?? 'USD';

          // Track unique per-account equity for portfolioHeat denominator
          if (currentAccountEquity != null && !totalEquityByAccount.has(row.accountId)) {
            totalEquityByAccount.set(row.accountId, currentAccountEquity);
            if (!currencyEquityByAccount.has(currency)) {
              currencyEquityByAccount.set(currency, new Map());
            }
            currencyEquityByAccount.get(currency)!.set(row.accountId, currentAccountEquity);
          }

          if (!totalsByCurrency[currency]) {
            totalsByCurrency[currency] = {
              grossRealizedPnl: 0,
              netRealizedPnl: 0,
              totalFees: 0,
              grossUnrealizedPnl: 0,
              netUnrealizedPnl: 0,
              totalOpenRisk: 0,
              portfolioHeat: 0,
            };
          }

          const gRP = metrics.realizedPnl.grossRealizedPnl ?? 0;
          const nRP = metrics.realizedPnl.netRealizedPnl ?? 0;
          const tF = metrics.fees.totalFees ?? 0;
          const gUP = metrics.unrealizedPnl.grossUnrealizedPnl ?? 0;
          const nUP = metrics.unrealizedPnl.netUnrealizedPnl ?? 0;
          const oR = metrics.risk.openRisk ?? 0;

          acc.grossRealizedPnl += gRP;
          acc.netRealizedPnl += nRP;
          acc.totalFees += tF;
          acc.grossUnrealizedPnl += gUP;
          acc.netUnrealizedPnl += nUP;
          acc.totalOpenRisk += oR;

          const bucket = totalsByCurrency[currency];
          bucket.grossRealizedPnl += gRP;
          bucket.netRealizedPnl += nRP;
          bucket.totalFees += tF;
          bucket.grossUnrealizedPnl += gUP;
          bucket.netUnrealizedPnl += nUP;
          bucket.totalOpenRisk += oR;

          return acc;
        },
        { grossRealizedPnl: 0, netRealizedPnl: 0, totalFees: 0, grossUnrealizedPnl: 0, netUnrealizedPnl: 0, totalOpenRisk: 0 },
      );

      // Compute portfolioHeat from unique account equities tracked during reduce
      const totalUniqueEquity = [...totalEquityByAccount.values()].reduce((s, v) => s + v, 0);
      const portfolioHeat = totalUniqueEquity > 0 && fullTotals.totalOpenRisk > 0
        ? (fullTotals.totalOpenRisk / totalUniqueEquity) * 100
        : 0;
      fullTotals = { ...fullTotals, portfolioHeat };

      // Compute per-currency portfolioHeat
      for (const [currency, bucket] of Object.entries(totalsByCurrency)) {
        const currencyEquities = currencyEquityByAccount.get(currency);
        const currencyTotalEquity = currencyEquities
          ? [...currencyEquities.values()].reduce((s, v) => s + v, 0)
          : 0;
        bucket.portfolioHeat = currencyTotalEquity > 0 && bucket.totalOpenRisk > 0
          ? (bucket.totalOpenRisk / currencyTotalEquity) * 100
          : 0;
      }
    }

    // ── plannedTotals: aggregate risk/capital across all planned trades ──
    // Respects accountId and direction filters but not date/status filters.
    const plannedFilters: any[] = [eq(trades.status, 'planned')];
    if (accountIdFilter) {
      plannedFilters.push(eq(trades.accountId, accountIdFilter));
    }
    if (directionFilter) {
      plannedFilters.push(eq(trades.direction, directionFilter as 'long' | 'short'));
    }
    const plannedWhere = plannedFilters.length > 0 ? and(...plannedFilters) : undefined;

    const plannedRows = db
      .select({
        plannedEntry: trades.plannedEntry,
        plannedStop: trades.plannedStop,
        plannedQuantity: trades.plannedQuantity,
      })
      .from(trades)
      .where(plannedWhere)
      .all();

    const plannedTotals = {
      totalPlannedRisk: plannedRows.reduce((sum, r) => {
        if (r.plannedEntry != null && r.plannedStop != null && r.plannedQuantity != null && r.plannedQuantity > 0) {
          return sum + Math.abs(r.plannedEntry - r.plannedStop) * r.plannedQuantity;
        }
        return sum;
      }, 0),
      totalPlannedCapital: plannedRows.reduce((sum, r) => {
        if (r.plannedEntry != null && r.plannedQuantity != null && r.plannedQuantity > 0) {
          return sum + r.plannedEntry * r.plannedQuantity;
        }
        return sum;
      }, 0),
      count: plannedRows.length,
    };

    return NextResponse.json({
      data: enhancedRows,
      total,
      page,
      limit,
      totals: fullTotals,
      totalsByCurrency,
      plannedTotals,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trades', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createTradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Resolve account: body.accountId overrides the default chain
    let accountId: string | undefined;

    if (parsed.data.accountId) {
      const provided = db
        .select()
        .from(accounts)
        .where(eq(accounts.id, parsed.data.accountId))
        .get();
      if (provided) {
        accountId = provided.id;
      }
    }

    if (!accountId) {
      const setting = db.select().from(settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId;
      } else {
        const firstActive = db
          .select()
          .from(accounts)
          .where(eq(accounts.isActive, true))
          .get();
        accountId = firstActive?.id;
      }
    }

    if (!accountId) {
      return NextResponse.json(
        { error: 'No active account found. Create an account first or set a default account in settings.' },
        { status: 400 }
      );
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    const hasOpeningCash = getSqliteHandle()
      .prepare(`SELECT EXISTS(SELECT 1 FROM financial_events WHERE account_id = ? AND event_type IN ('opening_balance', 'deposit')) AS has_cash`)
      .get(accountId) as { has_cash: number };
    if (!account?.isActive || account.maxRiskPerTradePct === null || account.defaultCommission === null || !hasOpeningCash.has_cash) {
      return NextResponse.json(
        { error: 'Account setup incomplete', details: 'Set risk parameters, post opening cash, then activate the account before trading.' },
        { status: 409 },
      );
    }

    const preTradePlanValue = parsed.data.preTradePlan ?? null;

    // Use setupId directly if provided, otherwise resolve setup name to UUID
    let resolvedSetupId: string | null = parsed.data.setupId ?? null;
    if (!resolvedSetupId && parsed.data.setup) {
      const resolved = resolveSetup(parsed.data.setup);
      if (resolved) {
        resolvedSetupId = resolved.id;
      }
    }

    // Retry loop: trade_code generation uses MAX(trade_code) which can race
    // under concurrent inserts. Retry up to 3 times on UNIQUE constraint.
    const MAX_RETRIES = 3;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const row = db.transaction(() => {
          // Generate tradeCode: T-XXXX
          // Use MAX(trade_code) to find the highest existing code, handling gaps from
          // stale data, deletions, or re-used test databases.
          const maxResult = db
            .select({ max: sql<string | null>`MAX(trade_code)` })
            .from(trades)
            .get();

          let nextNumber = 1;
          if (maxResult?.max) {
            const match = maxResult.max.match(/T-(\d+)/);
            if (match) {
              nextNumber = parseInt(match[1], 10) + 1;
            }
          }
          const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          db.insert(trades)
            .values({
              id,
              tradeCode,
              accountId,
              symbol: parsed.data.symbol,
              direction: parsed.data.direction,
              setupId: resolvedSetupId,
              sectorId: parsed.data.sectorId ?? null,
              marketConditionId: parsed.data.marketConditionId ?? null,
              status: 'planned',
              thesis: parsed.data.thesis ?? null,
              plannedEntry: parsed.data.plannedEntry ?? null,
              plannedStop: parsed.data.plannedStop ?? null,
              plannedTarget1: parsed.data.plannedTarget1 ?? null,
              plannedQuantity: parsed.data.plannedQuantity ?? null,
              invalidationCondition: parsed.data.invalidationCondition ?? null,
              preTradePlan: preTradePlanValue,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          return db
            .select()
            .from(trades)
            .where(eq(trades.id, id))
            .get()!;
        });

        return NextResponse.json(row, { status: 201 });
      } catch (error) {
        lastError = error;
        // Only retry on UNIQUE constraint violation (concurrent trade_code collision)
        if (
          error instanceof Error &&
          error.message.includes('UNIQUE constraint failed: trades.trade_code')
        ) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create trade', details: String(error) },
      { status: 500 }
    );
  }
}
