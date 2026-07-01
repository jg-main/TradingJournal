import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tradeRiskSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

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
