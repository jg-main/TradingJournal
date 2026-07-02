import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, settings, accounts, lookupValues } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveSetup } from '@/lib/setup-resolver';

const createTradeSchema = z.object({
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  direction: z.enum(['long', 'short']),
  accountId: z.string().uuid().optional(),
  setup: z.string().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  marketConditionId: z.string().nullable().optional(),
  thesis: z.string().nullable().optional(),
  plannedEntry: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  plannedTarget1: z.number().nullable().optional(),
  plannedTarget2: z.number().nullable().optional(),
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

    const validStatuses = ['idea', 'planned', 'open', 'closed', 'scratched'] as const;
    type TradeStatus = (typeof validStatuses)[number];

    // Total count
    let countQuery = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades);

    if (status) {
      countQuery = countQuery.where(eq(trades.status, status as TradeStatus));
    }

    const countResult = countQuery.get();
    const total = countResult?.count ?? 0;

    // Paginated data
    let dataQuery = db
      .select()
      .from(trades)
      .orderBy(desc(trades.createdAt))
      .limit(limit)
      .offset(offset);

    if (status) {
      dataQuery = dataQuery.where(eq(trades.status, status as TradeStatus));
    }

    const rows = dataQuery.all();
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
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // Resolve setup string to UUID using auto-create bridge
    const resolved = resolveSetup(parsed.data.setup);
    const resolvedSetupId = resolved ? resolved.id : null;

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
        plannedTarget2: parsed.data.plannedTarget2 ?? null,
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
