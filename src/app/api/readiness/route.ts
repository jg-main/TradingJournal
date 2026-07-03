import { NextResponse } from 'next/server';
import { db } from '@/db';
import { checkReadiness } from '@/lib/readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = checkReadiness(db);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to check readiness',
        details: String(error),
      },
      { status: 500 },
    );
  }
}
