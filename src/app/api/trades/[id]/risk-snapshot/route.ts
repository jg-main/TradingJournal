import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tradeRiskSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Trade risk snapshot — server-owned immutable historical evidence.
 *
 * M002-A3: the first-entry risk snapshot is canonical historical evidence
 * created by the first-fill execution engine (executeTradeFill) and repaired
 * ONLY by deterministic execution-correction logic (repairRiskSnapshot within
 * the trade-scoped correction transaction). Ordinary clients may read it but
 * may never create, edit, patch, or delete it.
 *
 *   Creation: canonical first-fill engine only
 *   Repair:   deterministic trade execution correction only
 *   Client:   GET only
 *
 * The previous public PUT (create/edit arbitrary risk numbers after the trade
 * executed) is retired: it allowed rewriting the historical risk baseline
 * independently of the immutable execution stream (retroactive manipulation of
 * account risk %, R-multiple baseline, and process analytics).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Risk snapshot not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch risk snapshot', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Retired mutation surface (M002-A3): deliberate API policy — the risk
 * snapshot is server-owned derived historical evidence and is immutable to
 * clients. Stable 405 contract for old callers; never mutates anything.
 */
export async function PUT(_request: NextRequest, _params: RouteParams) {
  return NextResponse.json(
    { error: 'Risk snapshot is immutable', code: 'RISK_SNAPSHOT_IMMUTABLE' },
    { status: 405, headers: { Allow: 'GET' } },
  );
}
