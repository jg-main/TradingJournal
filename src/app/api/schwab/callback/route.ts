/**
 * GET /api/schwab/callback
 *
 * Handles the Schwab OAuth callback redirect after the user authorizes
 * the application in the Schwab browser flow.
 *
 * Extracts the authorization code and state from query parameters,
 * exchanges the code for tokens, encrypts and stores them, then redirects
 * the browser back to the settings page with a status indicator.
 *
 * Expected query params:
 *   - code: string (authorization code from Schwab)
 *   - state: string (PKCE state from Schwab, contains code verifier)
 *   - error: string (present if the user denied authorization)
 *
 * Redirect targets:
 *   /settings/market-data?schwab=connected        — success
 *   /settings/market-data?schwab=error&reason=X   — failure (X = error code)
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/schwab-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // User denied authorization at Schwab
  if (error) {
    const settingsUrl = new URL('/settings/market-data', request.url);
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', `user_denied:${error}`);
    return NextResponse.redirect(settingsUrl);
  }

  // Missing authorization code
  if (!code) {
    const settingsUrl = new URL('/settings/market-data', request.url);
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', 'missing_code');
    return NextResponse.redirect(settingsUrl);
  }

  // Exchange code for tokens
  const result = await exchangeCode(code, state || undefined);

  const settingsUrl = new URL('/settings/market-data', request.url);

  if (!result.success) {
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', result.error);
    return NextResponse.redirect(settingsUrl);
  }

  // Success — tokens have been encrypted and persisted by the save callback
  settingsUrl.searchParams.set('schwab', 'connected');
  settingsUrl.searchParams.set('expiresAt', result.expiresAt);
  return NextResponse.redirect(settingsUrl);
}
