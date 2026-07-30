/**
 * Account Summary API Route
 *
 * GET /api/accounts/summary — lightweight per-account balance summary for
 *   the sidebar value block (M007 S03).
 *
 * Returns computed NAV from the account_performance projection table for
 * each account, falling back to starting_balance when no projection exists.
 * Includes an aggregate total and a live open-trade count for the Live dot.
 *
 * All numeric values are canonical decimal strings or null.  One SQL round
 * trip for accounts + performance, plus one for the open trade count.
 *
 * @module accounts/summary/route
 */

import { NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db';

// ── Row types ───────────────────────────────────────────────────────────

interface AccountSummaryRow {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  currentBalance: string | null;
  asOf: string | null;
}

interface AccountsResolved {
  accounts: AccountSummaryRow[];
  totalBalance: string | null;
  openTradeCount: number;
}

// ── Query helpers ───────────────────────────────────────────────────────

/**
 * Build the per-account summary.  nav comes from the account_performance
 * projection; starting_balance is the fallback when no projection exists.
 *
 * Uses raw SQL (better-sqlite3, no Drizzle import) for a single left-join
 * round trip.
 */
function queryAccountSummaries(): AccountSummaryRow[] {
  const db = getSqliteHandle();

  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.broker, a.currency,
              COALESCE(ap.nav, CAST(a.starting_balance AS TEXT)) AS current_balance,
              ap.computed_as_of
       FROM accounts a
       LEFT JOIN account_performance ap ON a.id = ap.account_id
       ORDER BY a.created_at DESC`,
    )
    .all() as {
    id: string;
    name: string;
    broker: string | null;
    currency: string;
    current_balance: string | null;
    computed_as_of: string | null;
  }[];

  // always non-null in the DB, but NULL guard for safety
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    broker: r.broker ?? null,
    currency: r.currency ?? 'USD',
    currentBalance: r.current_balance ?? null,
    asOf: r.computed_as_of ?? null,
  }));
}

function queryOpenTradeCount(): number {
  const db = getSqliteHandle();
  const row = db.prepare("SELECT COUNT(*) AS count FROM trades WHERE status = 'open'").get() as {
    count: number;
  };
  return row?.count ?? 0;
}

/** Sum all non-null currentBalances into a single total. */
function sumBalances(accounts: AccountSummaryRow[]): string | null {
  const total = accounts.reduce<number | null>((acc, a) => {
    if (a.currentBalance === null) return acc;
    const val = parseFloat(a.currentBalance);
    if (isNaN(val)) return acc;
    return (acc ?? 0) + val;
  }, null);
  return total !== null ? total.toFixed(2) : null;
}

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const rows = queryAccountSummaries();
    const openTradeCount = queryOpenTradeCount();
    const totalBalance = sumBalances(rows);

    const payload: AccountsResolved = {
      accounts: rows,
      totalBalance,
      openTradeCount,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to compute account summary',
        details: String(error),
      },
      { status: 500 },
    );
  }
}
