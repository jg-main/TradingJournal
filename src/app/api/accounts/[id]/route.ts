import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { accounts, settings, trades } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount } from '@/lib/account-lifecycle';
import { countAccountEvents, findAccountPerformance } from '@/db/accounting-repository';
import { accountCurrencySchema, isSupportedAccountCurrency } from '@/lib/accounting/currency-contract';

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  broker: z.string().max(200).nullable().optional(),
  // USD-only contract: only 'USD' is a valid currency value. Mutating to a
  // non-USD currency (EUR/GBP/etc.) is rejected even when the account has no
  // financial history — the product supports USD accounts only.
  currency: accountCurrencySchema.optional(),
  isActive: z.boolean().optional(),
  maxRiskPerTradePct: z.number().positive().nullable().optional(),
  defaultCommission: z.number().min(0).nullable().optional(),
  // Opening cash must be posted through account transactions, not account settings.
  startingBalance: z.never().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // ── 1. Fetch accounting projection (authoritative source post-cutover) ──
    const sqlite = getSqliteHandle();
    const projection = findAccountPerformance(sqlite, id);

    const nav = projection?.nav ?? null;
    const realizedPnl = projection?.realized_pnl ?? null;
    const unrealizedPnl = projection?.unrealized_pnl ?? null;
    const totalPnl = projection?.total_pnl ?? null;
    const netCash = projection?.net_cash ?? null;
    const markedPositions = projection?.marked_positions ?? null;
    const realizedFees = projection?.realized_fees ?? null;
    const grossExposure = projection?.gross_exposure ?? null;
    const netExposure = projection?.net_exposure ?? null;

    // ── 2. Return authoritative accounting-derived values ────────────────
    return NextResponse.json({
      ...account,
      // Cash and position data from the authoritative accounting projection
      nav: nav ? parseFloat(nav) : null,
      netCash: netCash ? parseFloat(netCash) : null,
      markedPositions: markedPositions ? parseFloat(markedPositions) : null,
      currentBalance: nav ? parseFloat(nav) : null,
      realizedPnl: realizedPnl ? parseFloat(realizedPnl) : null,
      unrealizedPnl: unrealizedPnl ? parseFloat(unrealizedPnl) : null,
      totalPnl: totalPnl ? parseFloat(totalPnl) : null,
      realizedFees: realizedFees ? parseFloat(realizedFees) : null,
      grossExposure: grossExposure ? parseFloat(grossExposure) : null,
      netExposure: netExposure ? parseFloat(netExposure) : null,
      // KPIs: trade-level metrics from the accounting system are not
      // available post-cutover. The projection tracks position-level
      // realized P&L but not individual trade counts, win rates, or
      // R-multiples. These fields remain null.
      kpis: null,

    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch account', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // ── Base-currency contract (USD-only) ──────────────────────────────
    // The update schema already restricts currency to 'USD', so a request
    // carrying EUR/GBP/etc. fails validation with 400 before reaching here.
    // Two additional rules keep the contract airtight:
    //
    // 1. A legacy account persisted with a non-USD currency must NEVER be
    //    silently rewritten to USD (or anything else) — that would reinterpret
    //    historical rows. If the caller explicitly supplies a currency for
    //    such an account, reject it.
    // 2. A USD account with financial history keeps the existing guard: base
    //    currency is fixed once events exist (posting kernel hardcodes USD in
    //    ledger postings, so changing the declared currency would diverge it
    //    from the ledger).
    if (parsed.data.currency !== undefined) {
      const sqlite = getSqliteHandle();
      const persistedCurrency = existing.currency ?? 'USD';

      // Legacy non-USD rows are immutable: never rewrite them.
      if (!isSupportedAccountCurrency(persistedCurrency)) {
        return NextResponse.json(
          {
            error:
              `Unsupported account currency "${persistedCurrency}". ` +
              'This installation currently supports USD account accounting only. ' +
              'Existing non-USD accounts are preserved and remain readable; ' +
              'their currency cannot be changed.',
          },
          { status: 400 },
        );
      }

      // USD → USD is a no-op. Guard the pre-existing mutation rule for any
      // future supported-currency expansion.
      if (parsed.data.currency !== persistedCurrency) {
        const eventCount = countAccountEvents(sqlite, id);
        if (eventCount > 0) {
          return NextResponse.json(
            {
              error:
                'Cannot change base currency: account has financial history. ' +
                'Base currency is fixed once financial events are posted; ' +
                'create a new account for a different base currency.',
            },
            { status: 409 },
          );
        }
      }
    }

    const accountTrades = db.select({ status: trades.status }).from(trades).where(eq(trades.accountId, id)).all();

    if (parsed.data.isActive === false && !canDeactivateAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot deactivate account with open trades' },
        { status: 409 },
      );
    }

    if (parsed.data.isActive === true && !canReactivateAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot reactivate account with open trades' },
        { status: 409 },
      );
    }

    db.update(accounts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    // Default-account coherence (D6): deactivating the settings default account
    // leaves a stale reference that consumers silently fall back from. Clear it
    // so resolution moves to the first active account. No-op when this account
    // is not the configured default.
    if (parsed.data.isActive === false) {
      db.update(settings)
        .set({ defaultAccountId: null, updatedAt: new Date().toISOString() })
        .where(eq(settings.defaultAccountId, id))
        .run();
    }

    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update account', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const accountTrades = db.select({ status: trades.status }).from(trades).where(eq(trades.accountId, id)).all();

    if (!canDeleteAccount(accountTrades)) {
      return NextResponse.json(
        { error: 'Cannot delete account with any trade history' },
        { status: 409 },
      );
    }

    db.delete(accounts)
      .where(eq(accounts.id, id))
      .run();

    return NextResponse.json({ message: 'Account deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete account', details: String(error) },
      { status: 500 }
    );
  }
}
