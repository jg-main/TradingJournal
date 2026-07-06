import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, settings, accounts, lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';

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
        exitNotes: trades.exitNotes,
        lesson: trades.lesson,
        createdAt: trades.createdAt,
        updatedAt: trades.updatedAt,
      })
      .from(trades)
      .leftJoin(setupDefinitions, eq(trades.setupId, setupDefinitions.id))
      .leftJoin(lookupValues, eq(trades.setupId, lookupValues.id))
      .where(statusFilter.length > 0 ? and(...statusFilter) : undefined)
      .orderBy(desc(trades.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    return NextResponse.json({ data: rows, total, page, limit });
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

    // Read per-account risk parameters and append to preTradePlan metadata
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();

    let preTradePlanValue = parsed.data.preTradePlan ?? null;
    if (account) {
      const riskParts: string[] = [];
      if (account.name) riskParts.push(`Account: ${account.name}`);
      if (account.maxRiskPerTradePct != null) riskParts.push(`Max Risk Per Trade: ${account.maxRiskPerTradePct}%`);
      if (account.defaultCommission != null) riskParts.push(`Default Commission: $${account.defaultCommission}`);
      if (account.startingBalance != null) riskParts.push(`Starting Balance: $${account.startingBalance}`);

      if (riskParts.length > 0) {
        const metadata = `--- Risk Parameters ---\n${riskParts.join('\n')}`;
        preTradePlanValue = preTradePlanValue
          ? `${preTradePlanValue}\n\n${metadata}`
          : metadata;
      }
    }

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

    // Use setupId directly if provided, otherwise resolve setup name to UUID
    let resolvedSetupId: string | null = parsed.data.setupId ?? null;
    if (!resolvedSetupId && parsed.data.setup) {
      const resolved = resolveSetup(parsed.data.setup);
      if (resolved) {
        resolvedSetupId = resolved.id;
      }
    }

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

    const row = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create trade', details: String(error) },
      { status: 500 }
    );
  }
}
