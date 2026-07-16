import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { trades, settings, accounts, lookupValues, setupDefinitions, tradeRiskSnapshots, tradeExecutions } from '@/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';
import { calculatePnL } from '@/lib/trade-calc';
import { calculateUnrealizedPnL } from '@/lib/mark-to-market';
import type { ExecutionData, Direction } from '@/lib/trade-calc';

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

    // Build status filter conditions
    const statusFilter = status
      ? [eq(trades.status, status as TradeStatus)]
      : [];

    // Total count
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(statusFilter.length > 0 ? and(...statusFilter) : undefined)
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
        actualEntry: sql<number | null>`(
          SELECT AVG(te.price) FROM ${tradeExecutions} te
          WHERE te.trade_id = ${trades.id}
          AND te.action IN (CASE WHEN ${trades.direction} = 'short' THEN 'sell_short' ELSE 'buy' END)
        )`,
        avgExitPrice: sql<number | null>`(
          SELECT CASE WHEN ${trades.direction} = 'short'
            THEN (SELECT AVG(te.price) FROM ${tradeExecutions} te WHERE te.trade_id = ${trades.id} AND te.action = 'buy_to_cover')
            ELSE (SELECT AVG(te.price) FROM ${tradeExecutions} te WHERE te.trade_id = ${trades.id} AND te.action IN ('sell', 'reduce'))
          END
        )`,
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
        riskPct: tradeRiskSnapshots.accountRiskPct,
      })
      .from(trades)
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .leftJoin(tradeRiskSnapshots, eq(trades.id, tradeRiskSnapshots.tradeId))
      .where(statusFilter.length > 0 ? and(...statusFilter) : undefined)
      .orderBy(desc(trades.openedAt), desc(trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Batch-fetch executions for all returned trades
    const tradeIds = rows.map((r) => r.id);
    const execRows =
      tradeIds.length > 0
        ? db
            .select()
            .from(tradeExecutions)
            .where(inArray(tradeExecutions.tradeId, tradeIds))
            .all()
        : [];

    // Group executions by trade ID
    const execMap = new Map<string, ExecutionData[]>();
    for (const ex of execRows) {
      const list = execMap.get(ex.tradeId) ?? [];
      list.push({
        action: ex.action,
        quantity: ex.quantity,
        price: ex.price,
        fees: ex.fees ?? 0,
        executedAt: ex.executedAt ?? new Date().toISOString(),
      });
      execMap.set(ex.tradeId, list);
    }

    // Compute enhanced rows with server-computed fields
    const enhancedRows = rows.map((row) => {
      const exs = execMap.get(row.id) ?? [];
      const direction = row.direction as Direction;

      let realizedPnl: number | null = null;
      let unrealizedPnl: number | null = null;
      let returnPct: number | null = null;
      const riskPct = row.riskPct;

      if (exs.length > 0) {
        const pnl = calculatePnL(exs, direction);

        if (row.status === 'closed') {
          realizedPnl = pnl.totalRealizedPnL;
          if (pnl.avgEntryPrice != null && pnl.totalEntryQty > 0) {
            returnPct = (realizedPnl / (pnl.avgEntryPrice * pnl.totalEntryQty)) * 100;
          }
        } else if (row.status === 'open' && row.currentPrice != null) {
          const unrealized = calculateUnrealizedPnL({
            executions: exs,
            direction,
            currentPrice: row.currentPrice,
            feePolicy: 'exclude_entry_fees',
          });
          unrealizedPnl = unrealized;
          if (unrealized != null && pnl.avgEntryPrice != null && pnl.totalEntryQty > 0) {
            returnPct = (unrealized / (pnl.avgEntryPrice * pnl.totalEntryQty)) * 100;
          }
        }
      }

      return {
        ...row,
        realizedPnl,
        unrealizedPnl,
        returnPct,
        riskPct,
      };
    });

    return NextResponse.json({ data: enhancedRows, total, page, limit });
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
