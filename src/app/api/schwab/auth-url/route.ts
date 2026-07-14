/**
 * GET /api/schwab/auth-url
 *
 * Generates a Schwab OAuth authorization URL with PKCE for the browser
 * OAuth redirect flow.
 *
 * Returns:
 *   200: { authUrl: string } — redirect the user to this URL
 *   400: { error: 'not_configured', message: string } — env vars missing
 *   500: { error: string, message: string } — URL generation failure
 */

import { NextResponse } from 'next/server';
import { generateAuthUrl, schwabIsConfigured } from '@/lib/schwab-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!schwabIsConfigured()) {
    return NextResponse.json(
      {
        error: 'not_configured' as const,
        message:
          'Schwab API credentials are not configured. ' +
          'Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REDIRECT_URI in your environment.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await generateAuthUrl();

    if ('error' in result) {
      return NextResponse.json(
        {
          error: 'generation_failed' as const,
          message: 'Failed to generate Schwab authorization URL: ' + result.error,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'generation_failed' as const,
        message: 'Failed to generate Schwab authorization URL: ' + message,
      },
      { status: 500 },
    );
  }
}
