/**
 * POST /api/schwab/disconnect
 *
 * Disconnects the Schwab OAuth connection by clearing stored tokens.
 *
 * Response:
 *   200: { success: true }
 *   500: { error: 'clear_failed', message: string } — token clearing failed
 *
 * Safety: Idempotent — calling disconnect when already disconnected
 * returns success: true with no side effects.
 */

import { NextResponse } from 'next/server';
import { clearTokens } from '@/lib/schwab-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await clearTokens();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[schwab-disconnect] Failed to clear tokens:', message);
    return NextResponse.json(
      {
        error: 'clear_failed' as const,
        message: 'Failed to disconnect Schwab: ' + message,
      },
      { status: 500 },
    );
  }
}
