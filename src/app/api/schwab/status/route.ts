/**
 * GET /api/schwab/status
 *
 * Returns the current Schwab OAuth connection state.
 *
 * Response shape:
 *   200: {
 *     connected: boolean,
 *     expiresAt: string | null,
 *     errorType?: 'not_configured' | 'token_expired'
 *   }
 *
 * The status is derived from the encrypted token store:
 *   - not_configured:  SCHWAB_CLIENT_ID / SECRET / REDIRECT_URI are missing
 *   - connected: true   Valid, non-expired tokens exist
 *   - connected: false  No tokens or tokens have expired (errorType tells which)
 *   - token_expired:    Tokens exist but are past their expiry date
 *
 * Error states surfaced:
 *   500: { error: 'status_check_failed', message: string } — DB or crypto error
 */

import { NextResponse } from 'next/server';
import { getTokenStatus } from '@/lib/schwab-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getTokenStatus();

    return NextResponse.json(status, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[schwab-status] Token status check failed:', message);
    return NextResponse.json(
      {
        error: 'status_check_failed' as const,
        message: 'Failed to check Schwab connection status: ' + message,
      },
      { status: 500 },
    );
  }
}
