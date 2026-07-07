import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeCheckResults, checklistDefinitions } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const trade = db.select().from(trades).where(eq(trades.id, id)).get();
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const rows = db
      .select({
        id: tradeCheckResults.id,
        tradeId: tradeCheckResults.tradeId,
        checklistDefinitionId: tradeCheckResults.checklistDefinitionId,
        description: checklistDefinitions.description,
        passed: tradeCheckResults.passed,
        comment: tradeCheckResults.comment,
        checkedAt: tradeCheckResults.checkedAt,
        createdAt: tradeCheckResults.createdAt,
      })
      .from(tradeCheckResults)
      .innerJoin(
        checklistDefinitions,
        eq(checklistDefinitions.id, tradeCheckResults.checklistDefinitionId),
      )
      .where(eq(tradeCheckResults.tradeId, id))
      .orderBy(asc(tradeCheckResults.checkedAt), asc(tradeCheckResults.createdAt))
      .all();

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trade check results', details: String(error) },
      { status: 500 },
    );
  }
}
